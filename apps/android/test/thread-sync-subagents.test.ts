import type { RpcClient } from "@codewide/sync-client";
import type { SqliteExecutor, SqliteValue } from "@codewide/tanstack-db-sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadDetailDatabase } from "../src/data/thread-detail-database-contract";
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
// replaced; the summary queries, persistence and subagent activity derivation run on real SQLite.
vi.mock("../src/data/ui-cache-persistence.native", () => ({
  getUiCacheSqliteDatabase: () => sqlite.database,
}));

import { createThreadSummaryDatabase } from "../src/data/thread-summary-database.native";
import { createThreadSummarySqlite } from "../src/data/thread-summary-sqlite.native";
import { createThreadSyncRuntime } from "../src/data/thread-sync-runtime";

beforeEach(() => sqlite.native.exec("DROP TABLE IF EXISTS codewide_thread_summaries; DROP TABLE IF EXISTS codewide_legacy_thread_pins"));

/** A root whose own turn ended while the catalog still records one of its agents as working. */
async function seedWorkingAgent() {
  const writer = createThreadSummarySqlite();
  await writer.prepare();
  writer.begin();
  writer.write({ type: "insert", value: summary("root", { activeSubagents: true }) });
  writer.write({
    type: "insert",
    value: summary("root:agent:a1", { parentThreadId: "root", status: { activeFlags: [], type: "active" } }),
  });
  await writer.commit({ durable: true });
  await writer.close();
  const database = createThreadSummaryDatabase();
  await database.prepare();
  return database;
}

function agentRow(running: boolean) {
  return {
    agentNickname: "Explore", agentRole: null, archived: false, cliVersion: "claude", createdAt: 1,
    cwd: "/repo", id: "root:agent:a1", modelProvider: "anthropic", parentThreadId: "root",
    running, source: "appServer", updatedAt: 2,
  };
}

function syncAnswer(subagents: unknown) {
  return {
    activeTurn: null,
    executionSettings: null,
    history: { hasMore: false, headTurnId: null, kind: "current", olderCursor: null, turns: [] },
    readModelVersion: 4,
    subagents,
    thread: { ...createV1TestThread("root", null, 1, []), cwd: "/repo" },
    throughCursor: 0,
  };
}

function syncRuntime(database: ReturnType<typeof createThreadSummaryDatabase>, answer: unknown) {
  const done = () => undefined;
  // WHY: a history read reaches only these detail members for an empty current snapshot; the
  // complete detail database is SQLite/JSI-backed and outside this subagent contract.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const details = {
    beginProjectionSnapshot: () => done,
    chat: { beginBackendRefresh: () => done, confirmBackendRefresh: done },
    getThread: () => null,
    hasPendingDelivery: () => false,
    historyCursor: () => null,
    historySourceWitness: () => undefined,
    latestSealedTurnId: async () => null,
    liveRevision: () => 0,
    reconcileNativeCommands: async () => undefined,
    synchronizeThread: async () => undefined,
  } as unknown as ThreadDetailDatabase;
  // WHY: the session is compared by identity only; the sync RPC goes through rpcAfterAttach.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const session = {} as RpcClient;
  const refreshSubagents = vi.fn(async (_connectionId: string, _rootThreadId: string) => undefined);
  const sync = createThreadSyncRuntime({
    clearInvalidationArchived: () => undefined,
    declareInterest: async () => undefined,
    getDetails: () => details,
    getSession: () => session,
    getSummaries: () => database,
    loadTurnControls: async () => undefined,
    readInvalidationArchived: () => undefined,
    refreshSubagents,
    refreshThreadCatalog: async () => undefined,
    // WHY: the runtime selects the result type of this generic RPC and validates the answer.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    rpcAfterAttach: async <T,>() => answer as T,
    transferAccess: async () => {
      throw new Error("no transfer authority");
    },
  });
  return { refreshSubagents, sync };
}

describe("thread sync subagent snapshot", () => {
  it("settles an agent the snapshot reports finished and the root's working state", async () => {
    const database = await seedWorkingAgent();
    const { refreshSubagents, sync } = syncRuntime(database, syncAnswer({ threads: [agentRow(false)] }));

    await sync.readThread("server", "root", undefined, true);

    await vi.waitFor(async () => {
      expect((await database.get("server", "root:agent:a1"))?.status.type).toBe("idle");
      expect((await database.get("server", "root"))?.activeSubagents).toBe(false);
    });
    expect(refreshSubagents).not.toHaveBeenCalled();
    database.close();
  });

  it("keeps the cached agents and reads the index separately without snapshot rows", async () => {
    const database = await seedWorkingAgent();
    const { refreshSubagents, sync } = syncRuntime(database, syncAnswer(null));

    await sync.readThread("server", "root", undefined, true);

    await vi.waitFor(() => expect(refreshSubagents).toHaveBeenCalledWith("server", "root"));
    expect((await database.get("server", "root:agent:a1"))?.status.type).toBe("active");
    expect((await database.get("server", "root"))?.activeSubagents).toBe(true);
    database.close();
  });

  it("keeps the cached agents and the history read when snapshot rows are malformed", async () => {
    const database = await seedWorkingAgent();
    const { refreshSubagents, sync } = syncRuntime(
      database,
      syncAnswer({ threads: [{ ...agentRow(false), running: "no" }] }),
    );

    const window = await sync.readThread("server", "root", undefined, true);

    expect(window?.thread.id).toBe("root");
    expect(refreshSubagents).not.toHaveBeenCalled();
    expect((await database.get("server", "root:agent:a1"))?.status.type).toBe("active");
    database.close();
  });
});
