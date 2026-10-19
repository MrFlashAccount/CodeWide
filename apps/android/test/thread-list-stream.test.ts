import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import type { SqliteExecutor, SqliteValue } from "@codewide/tanstack-db-sqlite";
import type { SyncEvent } from "@codewide/sync-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listedThread, rowsFrame, streamGeneration, testListStream, type ListMeta } from "./fixtures/threadListRows";
import { summary } from "./fixtures/thread-summary";
import { createV1TestThread } from "./fixtures/v1Thread";

const sqlite = await vi.hoisted(async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const native = new DatabaseSync(":memory:");
  const executor = {
    async execute(sql: string, params: readonly SqliteValue[] = []) {
      const values = params.map((value) => {
        if (value === null || typeof value === "string" || typeof value === "number") return value;
        throw new Error("Unexpected summary SQL parameter");
      });
      const statement = native.prepare(sql);
      return statement.columns().length > 0 ? { rows: statement.all(...values) } : statement.run(...values);
    },
  };
  let tail = Promise.resolve();
  const database = {
    ...executor,
    transaction<T>(operation: (executor: SqliteExecutor) => Promise<T>): Promise<T> {
      const next = tail.then(async () => {
        native.exec("BEGIN");
        try {
          const result = await operation(executor);
          native.exec("COMMIT");
          return result;
        } catch (cause) {
          native.exec("ROLLBACK");
          throw cause;
        }
      });
      tail = next.then(() => undefined, () => undefined);
      return next;
    },
  };
  return { native, database };
});

// WHY: Node cannot open the Android JSI database. Only that native connection boundary is
// replaced; the summary writes, race rule and publication run on real SQLite.
vi.mock("../src/data/ui-cache-persistence.native", () => ({
  getUiCacheSqliteDatabase: () => sqlite.database,
}));

import { createThreadSummaryDatabase } from "../src/data/thread-summary-database.native";
import { createThreadSummarySqlite } from "../src/data/thread-summary-sqlite.native";

beforeEach(() => sqlite.native.exec("DROP TABLE IF EXISTS codewide_thread_summaries; DROP TABLE IF EXISTS codewide_legacy_thread_pins"));

function row(id: string, meta: ListMeta, overrides: Partial<Thread> = {}) {
  return listedThread({ ...createV1TestThread(id, null, 1, []), cwd: "/repo", ...overrides }, meta);
}

async function seed(...rows: ReturnType<typeof summary>[]): Promise<void> {
  const writer = createThreadSummarySqlite();
  await writer.prepare();
  writer.begin();
  for (const value of rows) writer.write({ type: "insert", value });
  await writer.commit({ durable: true });
  await writer.close();
}

async function open(generation = 1) {
  const list = testListStream();
  list.stream.accept("server", { generation, kind: "generation" });
  const database = createThreadSummaryDatabase(list.options);
  await database.prepare();
  const push = async (rows: readonly unknown[], removed: { cursor: number; threadId: string }[] = []) =>
    database.applyServerRows("server", streamGeneration(list.stream), rowsFrame(rows, removed));
  const page = async (rows: readonly unknown[], generationAtRead = list.stream.race.generation("server")) => {
    const read = database.beginCatalogRead("server");
    const parsed = rows.length === 0 ? [] : rowsFrame(rows).rows;
    await database.applyCatalogPage("server", { generation: generationAtRead, rows: parsed }, false, new Set(parsed.map((entry) => entry.threadId)), read, true, "/repo");
    read.release();
  };
  return { ...list, database, page, push };
}

const completed = (cursor: number, threadId: string): SyncEvent => ({
  cursor,
  payload: {
    method: "turn/completed",
    params: { threadId, turn: { id: `turn-${cursor}` } },
    codewideThreadPatch: {
      version: 1,
      threadId,
      operation: { kind: "turnCompleted", summary: { activity: true, finalAgentResponse: true } },
    },
  },
});

describe("thread-list stream ingress", () => {
  it("applies frames of the current generation in order and drops a replaced socket's frames", () => {
    const { applied, stream } = testListStream();
    const frame = { removed: [], rows: [row("a", { cursor: 1 })], type: "threadListRows" };

    expect(stream.accept("server", { frame, generation: 1, kind: "rows" })).toBe("accepted");
    expect(applied).toEqual([]);
    stream.accept("server", { generation: 1, kind: "generation" });
    stream.accept("server", { frame, generation: 1, kind: "rows" });
    stream.accept("server", { frame: { ...frame, rows: [row("b", { cursor: 2 })] }, generation: 1, kind: "rows" });
    stream.accept("server", { generation: 2, kind: "generation" });
    stream.accept("server", { frame, generation: 1, kind: "rows" });

    expect(applied.map(({ frame: value }) => (value as { rows: { threadId: string }[] }).rows.map((entry) => entry.threadId))).toEqual([["a"], ["b"]]);
  });

  it.each([
    { removed: [], rows: [], type: "threadListRows" },
    { removed: [], rows: [{ id: "bad" }], type: "threadListRows" },
    { removed: [{ cursor: 1, threadId: "a" }], rows: [row("a", { cursor: 2 })], type: "threadListRows" },
    { removed: [], rows: Array.from({ length: 101 }, (_, index) => row(`t${index}`, { cursor: index })), type: "threadListRows" },
  ])("rejects an invalid frame as a whole", (frame) => {
    const { applied, stream } = testListStream();
    stream.accept("server", { generation: 1, kind: "generation" });
    expect(stream.accept("server", { frame, generation: 1, kind: "rows" })).toBe("invalid");
    expect(applied).toEqual([]);
  });
});

describe("server rows racing pages and events", () => {
  it("writes ten pushed rows in one publication and keeps every device-owned field", async () => {
    await seed(summary("t0", { lastSeenCursor: 3, latestActivityCursor: 4, unread: 1, firstUnreadAgentTurnId: "answer" }));
    const { database, push, serverRows } = await open();
    const publish = vi.spyOn(database.model, "publish");

    await push(Array.from({ length: 10 }, (_, index) => row(`t${index}`, { cursor: 10 + index, liveActivity: { kind: "webSearch" } }, { preview: `Preview ${index}`, recencyAt: 50 + index, status: { type: "active", activeFlags: [] } })));

    expect(publish).toHaveBeenCalledTimes(1);
    expect(await database.get("server", "t0")).toMatchObject({
      firstUnreadAgentTurnId: "answer",
      lastSeenCursor: 3,
      latestActivityCursor: 4,
      preview: "Preview 0",
      recencyAt: 50,
      status: { type: "active" },
      unread: 1,
    });
    expect(serverRows.at(-1)?.change).toMatchObject({ kind: "merge", removedThreadIds: [] });
    expect(serverRows.at(-1)?.change.rows).toHaveLength(10);
    database.close();
  });

  it("keeps a push newer than a page that was read before it", async () => {
    const { database, page, push } = await open();
    await push([row("chat", { cursor: 25 }, { preview: "Pushed", status: { type: "active", activeFlags: [] } })]);
    await page([row("chat", { cursor: 20 }, { preview: "Listed", status: { type: "notLoaded" } })]);
    expect(await database.get("server", "chat")).toMatchObject({ preview: "Pushed", status: { type: "active" } });

    await page([row("chat", { cursor: 30 }, { preview: "Re-read", status: { type: "idle" } })]);
    expect(await database.get("server", "chat")).toMatchObject({ preview: "Re-read", status: { type: "idle" } });
    database.close();
  });

  it("drops a page read under a replaced generation, including its head eviction", async () => {
    await seed(summary("cached", { cwd: "/repo" }));
    const { database, page, stream } = await open();
    const generationAtRead = stream.race.generation("server");
    stream.accept("server", { generation: 2, kind: "generation" });

    await page([row("listed", { cursor: 5 })], generationAtRead);

    expect(await database.get("server", "listed")).toBeNull();
    expect(await database.get("server", "cached")).not.toBeNull();
    database.close();
  });

  it("does not let a page resurrect a row removed after its read, and forgets the tombstone after a newer page", async () => {
    const { database, page, push } = await open();
    await push([row("gone", { cursor: 5 })]);
    await push([], [{ cursor: 12, threadId: "gone" }]);
    expect(await database.get("server", "gone")).toBeNull();

    await page([row("gone", { cursor: 10 })]);
    expect(await database.get("server", "gone")).toBeNull();
    await page([row("gone", { cursor: 12 })]);
    expect(await database.get("server", "gone")).not.toBeNull();
    database.close();
  });

  it("forgets cursors with a new generation, so its first page replaces cached rows", async () => {
    const { database, page, push, stream } = await open();
    await push([row("chat", { cursor: 40 }, { preview: "Old socket" })]);
    stream.accept("server", { generation: 2, kind: "generation" });
    await page([row("chat", { cursor: 30 }, { preview: "New socket page" })]);
    expect((await database.get("server", "chat"))?.preview).toBe("New socket page");
    database.close();
  });

  it("does not evict a cached row a push changed while the page was being read", async () => {
    await seed(summary("pushed", { cwd: "/repo", recencyAt: 300 }), summary("stale", { cwd: "/repo", recencyAt: 200 }));
    const { database, push, stream } = await open();
    const read = database.beginCatalogRead("server");
    await push([row("pushed", { cursor: 9 }, { recencyAt: 400 })]);
    const listed = rowsFrame([row("other", { cursor: 8 })]).rows;
    await database.applyCatalogPage("server", { generation: streamGeneration(stream), rows: listed }, false, new Set(["other"]), read, true, "/repo");
    read.release();

    expect(await database.get("server", "pushed")).not.toBeNull();
    expect(await database.get("server", "stale")).toBeNull();
    database.close();
  });

  it("holds an unread completion for a thread without a row until its server row arrives", async () => {
    const { database, push } = await open();
    await database.applyEvents("server", [completed(7, "late")]);
    expect(await database.get("server", "late")).toBeNull();

    await push([row("late", { cursor: 8 })]);

    expect(await database.get("server", "late")).toMatchObject({ firstUnreadAgentTurnId: "turn-7", latestActivityCursor: 7, unread: 1 });
    database.close();
  });

  it("derives a root's running sub-agents from pushed child rows", async () => {
    await seed(summary("root"));
    const { database, push } = await open();
    await push([row("child", { cursor: 3 }, { parentThreadId: "root", status: { type: "active", activeFlags: [] } })]);
    expect((await database.get("server", "root"))?.activeSubagents).toBe(true);
    await push([row("child", { cursor: 4 }, { parentThreadId: "root", status: { type: "idle" } })]);
    expect((await database.get("server", "root"))?.activeSubagents).toBe(false);
    database.close();
  });

  it("keeps a row pushed after a native snapshot's cursor when the snapshot omits it", async () => {
    await seed(summary("absent"));
    const { database, push } = await open();
    await push([row("pushed", { cursor: 15 })]);
    await database.applySnapshot("server", [{ archived: false, thread: row("listed", { cursor: 10 }) }], 10);

    expect(await database.get("server", "pushed")).not.toBeNull();
    expect(await database.get("server", "listed")).not.toBeNull();
    expect(await database.get("server", "absent")).toBeNull();
    database.close();
  });
});
