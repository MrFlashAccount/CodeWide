import { questionAnswerDelivery } from "./fixtures/questionAnswer";
import { storedThreadToListItem } from "../src/features/threadList/threadListProjection";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SqliteExecutor, SqliteValue } from "@codewide/tanstack-db-sqlite";
import { createV1TestThread } from "./fixtures/v1Thread";
import { summary } from "./fixtures/thread-summary";
import type { ThreadSummaryViewRequest } from "../src/data/thread-summary-model";
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
      return statement.columns().length > 0
        ? { rows: statement.all(...values) }
        : statement.run(...values);
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
      tail = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    },
  };
  return { native, database };
});

// WHY: Node cannot open the Android JSI database. Only replace that native
// connection boundary; all production queries, persistence and projections run on real SQLite.
vi.mock("../src/data/ui-cache-persistence.native", () => ({
  getUiCacheSqliteDatabase: () => sqlite.database,
}));

import { createThreadSummarySqlite } from "../src/data/thread-summary-sqlite.native";
import { createThreadSummaryDatabase } from "../src/data/thread-summary-database.native";

const request: ThreadSummaryViewRequest = {
  viewId: "project",
  connectionId: "server",
  projectCwd: "/repo",
  recentLimit: 2,
  archivedLimit: 2,
  selectedConnectionId: null,
  selectedThreadId: null,
  subagentConnectionId: null,
  subagentLimit: 0,
};

beforeEach(() => sqlite.native.exec("DROP TABLE IF EXISTS codewide_thread_summaries; DROP TABLE IF EXISTS codewide_legacy_thread_pins"));

describe("persisted project catalog", () => {
  it("marks every unread project chat across pages durably, leaving other projects and servers unread", async () => {
    const writer = createThreadSummarySqlite();
    await writer.prepare();
    const projectRows = [
      summary("first", { unread: 1, latestActivityCursor: 10 }),
      summary("second", { unread: 1, latestActivityCursor: 11, pinned: true }),
      summary("outside-page", { unread: 1, latestActivityCursor: 12, firstUnreadAgentTurnId: "answer" }),
      summary("archived", { unread: 1, latestActivityCursor: 13, archived: true }),
      summary("child", { unread: 1, latestActivityCursor: 14, parentThreadId: "first" }),
    ];
    const untouched = [
      summary("same-path-other-server", { connectionId: "other", unread: 1 }),
      summary("nested-path", { cwd: "/repo/nested", unread: 1 }),
      summary("different-project", { cwd: "/elsewhere", unread: 1 }),
      summary("deleted", { unread: 1, deleteCommandId: "delete" }),
    ];
    writer.begin();
    for (const value of [...projectRows, ...untouched]) writer.write({ type: "insert", value });
    await writer.commit({ durable: true });
    await writer.close();
    const database = createThreadSummaryDatabase();
    await database.prepare();
    await database.loadView({ ...request, recentLimit: 1 });
    expect(database.projectUnread.projects$.peek()).toContain("server\u0000/repo");
    await database.markProjectRead("server", "/repo");
    expect(database.projectUnread.projects$.peek()).not.toContain("server\u0000/repo");
    expect(database.model.view$({ ...request, recentLimit: 1 }).peek().recent.every((row) => row.unread === 0)).toBe(true);
    const reopened = createThreadSummarySqlite();
    for (const row of projectRows) {
      const persisted = await reopened.loadRow(row.connectionId, row.remoteThreadId);
      expect(persisted).toMatchObject({ unread: 0, lastSeenCursor: row.latestActivityCursor, firstUnreadAgentTurnId: null });
    }
    for (const row of untouched) expect((await reopened.loadRow(row.connectionId, row.remoteThreadId))?.unread).toBe(1);
    // A completion arriving after the read action belongs to a new unread boundary.
    await database.applyEvents("server", [{
      cursor: 15,
      payload: {
        method: "turn/completed",
        params: { threadId: "first" },
        codewideThreadPatch: {
          version: 1,
          threadId: "first",
          operation: { kind: "turnCompleted", summary: { activity: true, finalAgentResponse: true } },
        },
      },
    }]);
    expect((await database.get("server", "first"))?.unread).toBeGreaterThan(0);
    expect(database.projectUnread.projects$.peek()).toContain("server\u0000/repo");
    await reopened.close();
    database.close();
  });

  it("keeps a manual unread mark through refresh and replay until marked read", async () => {
    const writer = createThreadSummarySqlite();
    await writer.prepare();
    writer.begin();
    writer.write({
      type: "insert",
      value: summary("manual", { lastSeenCursor: 5, latestActivityCursor: 5 }),
    });
    await writer.commit({ durable: true });
    await writer.close();

    const database = createThreadSummaryDatabase();
    await database.prepare();
    await database.markUnread("server", "manual");
    expect((await database.get("server", "manual"))?.unread).toBe(1);
    expect(database.projectUnread.projects$.peek()).toEqual(["server\u0000/repo"]);
    const persistedUnread = createThreadSummarySqlite();
    expect((await persistedUnread.loadRow("server", "manual"))?.unread).toBe(1);
    await persistedUnread.close();

    await database.mergeSnapshots("server", [
      { archived: false, thread: createV1TestThread("manual", null, 1, []) },
    ]);
    await database.applyEvents("server", [
      {
        cursor: 5,
        payload: {
          method: "turn/completed",
          params: { threadId: "manual" },
          codewideThreadPatch: {
            version: 1,
            threadId: "manual",
            operation: {
              kind: "turnCompleted",
              summary: { activity: true, finalAgentResponse: true },
            },
          },
        },
      },
    ]);
    expect((await database.get("server", "manual"))?.unread).toBe(1);

    await database.markRead("server", "manual");
    expect((await database.get("server", "manual"))?.unread).toBe(0);
    expect(database.projectUnread.projects$.peek()).toEqual([]);
    database.close();
    const reopened = createThreadSummarySqlite();
    expect((await reopened.loadRow("server", "manual"))?.unread).toBe(0);
    await reopened.close();
  });

  it("clears the first unread turn boundary when the thread is marked read", async () => {
    const writer = createThreadSummarySqlite();
    await writer.prepare();
    writer.begin();
    writer.write({
      type: "insert",
      value: summary("anchored", {
        firstUnreadAgentTurnId: "first-unread",
        latestActivityCursor: 8,
        unread: 1,
      }),
    });
    await writer.commit({ durable: true });
    await writer.close();

    const database = createThreadSummaryDatabase();
    await database.prepare();
    await database.markRead("server", "anchored");

    expect(await database.get("server", "anchored")).toMatchObject({
      firstUnreadAgentTurnId: null,
      lastSeenCursor: 8,
      unread: 0,
    });
    database.close();
  });

  it("reopens a scoped page and unread membership independently of the global head", async () => {
    const writer = createThreadSummarySqlite();
    await writer.prepare();
    writer.begin();
    for (let i = 0; i < 50; i++)
      writer.write({
        type: "insert",
        value: summary(`other-${i}`, { cwd: "/other", recencyAt: 100 + i }),
      });
    for (const row of [
      summary("old-unread", { unread: 1 }),
      summary("recent", { recencyAt: 3 }),
      summary("second", { recencyAt: 2 }),
      summary("archive", { archived: true }),
    ]) {
      writer.write({ type: "insert", value: row });
    }
    await writer.commit({ durable: true });
    await writer.close();
    const reader = createThreadSummarySqlite();
    const page = await reader.loadView(request);
    expect(page.recent.map((row) => row.name)).toEqual(["recent", "second"]);
    expect(page.archived.map((row) => row.name)).toEqual(["archive"]);
    expect((await reader.loadUnread()).map((row) => row.name)).toEqual(["old-unread"]);
    const allProjectRows = await reader.loadView({ ...request, recentLimit: 36 });
    expect(allProjectRows.recent.map((row) => row.name)).toEqual([
      "recent",
      "second",
      "old-unread",
    ]);
    await reader.close();
  });

  it("project refresh cannot evict another project's rows or discard unread state", async () => {
    const writer = createThreadSummarySqlite();
    await writer.prepare();
    writer.begin();
    for (const row of [
      summary("mine"),
      summary("unread", { unread: 1 }),
      summary("other", { cwd: "/other" }),
    ])
      writer.write({ type: "insert", value: row });
    await writer.commit({ durable: true });
    await writer.close();
    const database = createThreadSummaryDatabase();
    await database.prepare();
    const read = database.beginCatalogRead("server");
    await database.applyCatalogPage("server", [], false, new Set(), read, true, "/repo");
    expect(await database.get("server", "mine")).toBeNull();
    expect((await database.get("server", "other"))?.cwd).toBe("/other");
    expect((await database.get("server", "unread"))?.unread).toBe(1);
    expect(database.projectUnread.projects$.peek()).toEqual(["server\u0000/repo"]);
    await database.markRead("server", "unread");
    expect(database.projectUnread.projects$.peek()).toEqual([]);
    read.release();
    await database.close();
  });

  it("applies server evictions to pinned unread rows and preserves other cached rows", async () => {
    const writer = createThreadSummarySqlite();
    await writer.prepare();
    writer.begin();
    writer.write({ type: "insert", value: summary("supervisor", { unread: 1, pinned: true }) });
    writer.write({ type: "insert", value: summary("ordinary", { unread: 1 }) });
    await writer.commit({ durable: true });
    await writer.close();
    const database = createThreadSummaryDatabase();
    await database.prepare();
    expect(await database.get("server", "supervisor")).not.toBeNull();
    await database.removeCatalogEntries("server", ["supervisor"]);
    expect(await database.get("server", "supervisor")).toBeNull();
    expect((await database.get("server", "ordinary"))?.unread).toBe(1);
    database.close();
    const reopened = createThreadSummarySqlite();
    expect(await reopened.loadRow("server", "supervisor")).toBeNull();
    expect((await reopened.loadRow("server", "ordinary"))?.unread).toBe(1);
    await reopened.close();
  });
});

it("does not reopen a completed sidebar row from an older thread read", async () => {
  const database = createThreadSummaryDatabase();
  await database.prepare();
  const active = {
    ...createV1TestThread("thread", null, 1, []),
    preview: "Old answer",
    status: { type: "active", activeFlags: [] } as const,
  };
  await database.mergeSnapshots("server", [{ archived: false, thread: active }]);
  await database.applyEvents("server", [{
    cursor: 20,
    payload: {
      method: "turn/completed",
      params: { threadId: "thread" },
      codewideThreadPatch: {
        version: 1,
        threadId: "thread",
        operation: {
          kind: "turnCompleted",
          summary: { activity: true, finalAgentResponse: true, previewText: "Final answer" },
        },
      },
    },
  }]);

  expect((await database.get("server", "thread"))?.status).toEqual({ type: "idle" });
  await database.mergeSnapshots("server", [{ archived: false, thread: active }], 19);
  const afterStaleRead = await database.get("server", "thread");
  expect(afterStaleRead?.status).toEqual({ type: "idle" });
  expect(afterStaleRead?.preview).toBe("Final answer");

  await database.mergeSnapshots("server", [{ archived: false, thread: active }], 21);
  expect((await database.get("server", "thread"))?.status).toEqual(active.status);
  await database.close();
});

it("obeys server membership on live/replayed events and private metadata, without inspecting thread source", async () => {
  const ordinary = {
    ...createV1TestThread("ordinary", null, 1, []),
    name: "ordinary",
    threadSource: "codewide-global-supervisor:server-admitted",
    codewideCatalogExcluded: false,
  };
  const home = { ...createV1TestThread("home", null, 1, []), codewideCatalogExcluded: true };
  const database = createThreadSummaryDatabase();
  await database.prepare();
  await database.mergeSnapshots("server", [
    { archived: false, thread: ordinary },
    { archived: false, thread: home },
  ]);
  expect((await database.get("server", "ordinary"))?.name).toBe("ordinary");
  expect(await database.get("server", "home")).toBeNull();
  await database.applyEvents("server", [
    {
      cursor: 1,
      payload: {
        method: "thread/started",
        params: { thread: home },
        codewideCatalogExcluded: true,
        codewideThreadPatch: {
          version: 1,
          threadId: "home",
          operation: { kind: "threadStarted", thread: home },
        },
      },
    },
  ]);
  expect(await database.get("server", "home")).toBeNull();
  await database.applyEvents("server", [
    {
      cursor: 2,
      payload: {
        method: "companion/thread/progress",
        params: { threadId: "ordinary" },
        codewideCatalogExcluded: true,
        codewideThreadPatch: {
          version: 1,
          threadId: "ordinary",
          operation: { kind: "threadProgress" },
        },
      },
    },
  ]);
  expect(await database.get("server", "ordinary")).toBeNull();
  database.close();
});

it("persists a skipped async question through catalog replay and database reopen", async () => {
  const database = createThreadSummaryDatabase();
  await database.prepare();
  const thread = createV1TestThread("question-thread", null, 1, []);
  await database.mergeSnapshots("server", [{ thread, archived: false }]);
  await database.skipQuestion({ connectionId: "server", threadId: thread.id, turnId: "turn", itemId: "question" });
  await database.mergeSnapshots("server", [{ thread, archived: false }]);
  database.close();
  const restored = createThreadSummaryDatabase();
  await restored.prepare();
  expect((await restored.get("server", thread.id))?.skippedQuestions).toEqual({ turnId: "turn", itemIds: ["question"] });
  restored.close();
});

it("updates only the answered catalog row from native events without refetch and deduplicates progress", async () => {
  const writer = createThreadSummarySqlite();
  await writer.prepare();
  writer.begin();
  writer.write({ type: "insert", value: summary("question-thread", { pendingQuestion: { turnId: "turn", itemIds: ["question"] }, unread: 1 }) });
  writer.write({ type: "insert", value: summary("unrelated") });
  await writer.commit({ durable: true });
  await writer.close();
  const database = createThreadSummaryDatabase();
  await database.prepare();
  await database.loadView(request);
  const remote = vi.fn(async () => false);
  database.setCatalogLoader(remote);
  const view = database.model.view$(request);
  const unrelated = view.peek().recent.find(row => row.remoteThreadId === "unrelated");
  const before = view.peek().recent.find(row => row.remoteThreadId === "question-thread");
  expect(before && storedThreadToListItem(before).needsAttention).toBe(true);
  const publish = vi.spyOn(database.model, "publish");
  await database.applyCommandDelivery(questionAnswerDelivery());
  const answered = view.peek().recent.find(row => row.remoteThreadId === "question-thread");
  expect(answered && storedThreadToListItem(answered)).toMatchObject({ needsAttention: false, unread: 1 });
  expect(view.peek().recent.find(row => row.remoteThreadId === "unrelated")).toBe(unrelated);
  expect(publish).toHaveBeenCalledTimes(1);
  const published = view.peek();
  for (const state of ["sending", "accepted", "uncertain", "delivered"] as const) {
    await database.applyCommandDelivery(questionAnswerDelivery(state));
  }
  expect(view.peek()).toBe(published);
  expect(publish).toHaveBeenCalledTimes(1);
  expect(remote).not.toHaveBeenCalled();
  database.close();
  const reopened = createThreadSummaryDatabase();
  await reopened.prepare();
  const persisted = await reopened.get("server", "question-thread");
  expect(persisted && storedThreadToListItem(persisted).needsAttention).toBe(false);
  await reopened.reconcileCommands([questionAnswerDelivery("failed")]);
  const failed = await reopened.get("server", "question-thread");
  expect(failed && storedThreadToListItem(failed).needsAttention).toBe(true);
  await reopened.applyCommandDelivery(questionAnswerDelivery("queued"));
  const retry = await reopened.get("server", "question-thread");
  expect(retry && storedThreadToListItem(retry).needsAttention).toBe(false);
  reopened.close();
});

it("captures legacy pins before clearing their display flags and preserves unread and confirmed pins", async () => {
  const writer = createThreadSummarySqlite();
  await writer.prepare();
  writer.begin();
  writer.write({ type: "insert", value: summary("legacy", { pinCursor: undefined, pinned: true, unread: 1 }) });
  writer.write({ type: "insert", value: summary("server-pin", { connectionId: "other", pinCursor: 7, pinned: true }) });
  await writer.commit({ durable: true });
  await writer.close();
  // Emulate the retired app's persisted payload, bypassing the new writer's normalization.
  sqlite.native.exec(`UPDATE codewide_thread_summaries SET pinned = 1,
    __payload = json_remove(json_set(__payload, '$.pinned', json('true')), '$.pinCursor')
    WHERE thread_id = 'legacy'`);
  const database = createThreadSummaryDatabase();
  await database.prepare();
  expect(await database.get("server", "legacy")).toMatchObject({ pinned: false, unread: 1 });
  expect(await database.loadPendingPinMigration("server")).toEqual(["legacy"]);
  expect(await database.loadPendingPinMigration("other")).toEqual([]);
  await database.applyPinSnapshot("server", { cursor: 10, threadIds: ["legacy"] });
  await database.applyEvents("server", [{ cursor: 11, payload: {
    method: "companion/thread/pin/updated", params: { threadId: "legacy", pinned: false, pinCursor: 11 },
    codewideThreadPatch: { version: 1, threadId: "legacy", operation: { kind: "threadPinned" } },
  } }]);
  await database.applyPinSnapshot("server", { cursor: 10, threadIds: ["legacy"] });
  expect(await database.get("server", "legacy")).toMatchObject({ pinned: false, pinCursor: 11, unread: 1 });
  expect(await database.get("other", "server-pin")).toMatchObject({ pinned: true, pinCursor: 7 });
  database.close();
  const reopened = createThreadSummarySqlite();
  expect(await reopened.loadRow("server", "legacy")).toMatchObject({ pinned: false, pinCursor: 11 });
  expect(await reopened.loadPendingPinMigration("server")).toEqual(["legacy"]);
  await reopened.acknowledgePinMigration("server", ["legacy"]);
  await reopened.close();
  const acknowledged = createThreadSummarySqlite();
  expect(await acknowledged.loadPendingPinMigration("server")).toEqual([]);
  await acknowledged.close();
});

it("rolls back legacy capture and flag clearing together when an upgrade transaction fails", async () => {
  const writer = createThreadSummarySqlite();
  await writer.prepare();
  writer.begin();
  writer.write({ type: "insert", value: summary("legacy", { unread: 1 }) });
  await writer.commit({ durable: true });
  await writer.close();
  sqlite.native.exec(`UPDATE codewide_thread_summaries SET pinned = 1,
    __payload = json_remove(json_set(__payload, '$.pinned', json('true')), '$.pinCursor')`);
  const transaction = sqlite.database.transaction.bind(sqlite.database);
  const failure = vi.spyOn(sqlite.database, "transaction").mockImplementationOnce(async (operation) =>
    transaction(async (executor) => {
      await operation(executor);
      throw new Error("Simulated upgrade commit failure");
    }),
  );
  const upgrading = createThreadSummarySqlite();
  await expect(upgrading.prepare()).rejects.toThrow("upgrade commit failure");
  failure.mockRestore();
  expect(sqlite.native.prepare("SELECT thread_id FROM codewide_legacy_thread_pins").all()).toEqual([]);
  expect(sqlite.native.prepare("SELECT pinned FROM codewide_thread_summaries").get()).toMatchObject({ pinned: 1 });
  await upgrading.prepare();
  expect(await upgrading.loadPendingPinMigration("server")).toEqual(["legacy"]);
  expect(await upgrading.loadRow("server", "legacy")).toMatchObject({ pinned: false, unread: 1 });
  await upgrading.close();
});

it("retains confirmed pins outside a bounded reconnect snapshot", async () => {
  const database = createThreadSummaryDatabase();
  await database.prepare();
  await database.mergeSnapshots("server", [{ archived: false, thread: createV1TestThread("old-pin", null, 1, []) }]);
  await database.applyPinSnapshot("server", { cursor: 10, threadIds: ["old-pin"] });
  await database.applySnapshot("server", [{ archived: false, thread: createV1TestThread("recent", null, 2, []) }], 10);
  expect(await database.get("server", "old-pin")).toMatchObject({ pinned: true, pinCursor: 10 });
  await database.applyPinSnapshot("server", { cursor: 11, threadIds: [] });
  expect(await database.get("server", "old-pin")).toMatchObject({ pinned: false, pinCursor: 11 });
  database.close();
});
