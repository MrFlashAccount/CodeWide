import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";

const sqlite = vi.hoisted(() => {
  const insertedRows: unknown[][] = [];
  const deletedKeys: string[] = [];
  const execute = vi.fn(async (sql: string, params: readonly unknown[] = []) => {
    if (sql.includes('SELECT COUNT(*) AS "row_count"')) return { rows: [{ row_count: 0 }] };
    if (sql.includes('DELETE FROM "codewide_thread_details"')) deletedKeys.push(String(params[0]));
    if (sql.includes('INSERT INTO "codewide_thread_details"')) insertedRows.push([...params]);
    return { rows: [] };
  });
  const database = {
    execute,
    transaction: vi.fn(async <T>(operation: (executor: { execute: typeof execute }) => Promise<T>) => await operation({ execute })),
  };
  return {
    database,
    execute,
    insertedRows,
    deletedKeys,
  };
});

vi.mock("../src/data/ui-cache-persistence.native", () => ({
  getUiCacheSqliteDatabase: () => sqlite.database,
  getUiCacheFileDiagnostics: async () => ({ mainFileBytes: 0, walFileBytes: 0, shmFileBytes: 0 }),
}));

import {
  createThreadDetailSqlite,
  prepareHistoryCacheAccounting,
  rotateHistoryCache,
} from "../src/data/thread-detail-sqlite.native";

describe("thread detail SQLite adapter", () => {
  beforeEach(() => {
    sqlite.execute.mockClear();
    sqlite.database.transaction.mockClear();
    sqlite.insertedRows.length = 0;
    sqlite.deletedKeys.length = 0;
  });

  it("starts the direct model without scanning obsolete collection tables", async () => {
    const storage = createThreadDetailSqlite(() => undefined);
    await storage.prepare();

    const sql = sqlite.execute.mock.calls.map(([statement]) => String(statement)).join("\n");
    expect(sql).not.toContain("collection_registry");
    expect(sql).not.toContain("__tanstack_db_sqlite_bootstrap");
    expect(sql).not.toContain("c_thread_details");
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "codewide_thread_detail_invalidations"');
    expect(sql).toContain('DROP TABLE IF EXISTS "codewide_thread_invalidations"');
    await storage.close();
  });

  it("persists refresh cursors through the chat-specific adapter", async () => {
    const storage = createThreadDetailSqlite(() => undefined);
    await storage.prepare();
    sqlite.execute.mockClear();

    await storage.upsertInvalidations([{ connectionId: "server", threadId: "thread", cursor: 17 }]);
    await storage.clearInvalidation("server", "thread", 17);

    const statements = sqlite.execute.mock.calls.map(([statement]) => String(statement));
    expect(statements).toContainEqual(expect.stringContaining('INSERT INTO "codewide_thread_detail_invalidations"'));
    expect(statements).toContainEqual(expect.stringContaining('DELETE FROM "codewide_thread_detail_invalidations"'));
    await storage.close();
  });

  it("persists a direct-delivery projection until canonical history takes ownership", async () => {
    const storage = createThreadDetailSqlite(() => undefined);
    await storage.prepare();
    sqlite.insertedRows.length = 0;
    sqlite.deletedKeys.length = 0;

    storage.begin();
    storage.write({
      type: "insert",
      value: {
        id: "delivery",
        kind: "pending",
        connectionId: "server",
        remoteThreadId: "thread",
        remoteTurnId: null,
        historyEpoch: 0,
        ordinal: 1,
        sessionId: null,
        lastOpenedAt: 0,
        sealed: false,
        thread: null,
        turn: null,
        turnMetadata: null,
        activityItems: null,
        pending: {
          commandId: "command",
          method: "turn/start",
          presentation: "delivery",
          text: "hello",
          attachments: [],
          state: "accepted",
          attempts: 1,
          lastError: null,
          createdAt: 1,
          updatedAt: 2,
          order: 1,
        },
      },
    });
    await storage.commit({ durable: true });

    expect(sqlite.insertedRows).toHaveLength(1);
    expect(sqlite.insertedRows[0]?.[0]).toBe("string:delivery");
    expect(sqlite.deletedKeys).toEqual([]);
    await storage.close();
  });

  it("discards an abandoned logical transaction before the next writer begins", async () => {
    const committed: unknown[][] = [];
    const storage = createThreadDetailSqlite((changes) => committed.push([...changes]));
    await storage.prepare();

    storage.begin();
    storage.write({ type: "delete", key: "abandoned" });
    storage.rollback();

    expect(() => storage.begin()).not.toThrow();
    storage.write({ type: "delete", key: "committed" });
    await storage.commit({ durable: true });

    expect(committed).toEqual([[{ type: "delete", key: "committed" }]]);
    expect(sqlite.deletedKeys).toEqual(["string:committed"]);
    await storage.close();
  });

  it("guards an off-window canonical turn from a pending mirror", async () => {
    const storage = createThreadDetailSqlite(() => undefined);
    await storage.prepare();
    sqlite.execute.mockClear();

    storage.begin();
    storage.write({
      type: "insert",
      value: {
        id: "stable-client-key",
        kind: "pending",
        connectionId: "server",
        remoteThreadId: "thread",
        remoteTurnId: null,
        historyEpoch: 0,
        ordinal: 1,
        sessionId: null,
        lastOpenedAt: 0,
        sealed: false,
        thread: null,
        turn: null,
        turnMetadata: null,
        activityItems: null,
        pending: {
          commandId: "command",
          method: "turn/start",
          presentation: "delivery",
          text: "hello",
          attachments: [],
          state: "failed",
          attempts: 1,
          lastError: "rejected",
          createdAt: 1,
          updatedAt: 2,
          order: 1,
        },
      },
    });
    await storage.commit({ durable: true });

    const statement = sqlite.execute.mock.calls
      .map(([sql]) => String(sql))
      .find((sql) => sql.includes('INSERT INTO "codewide_thread_details"'));
    expect(statement).toContain('WHERE "codewide_thread_details"."kind" != \'turn\'');
    await storage.close();
  });

  it("does not import rows from another persistence runtime", async () => {
    const storage = createThreadDetailSqlite(() => undefined);
    await storage.prepare();

    expect(sqlite.insertedRows).toEqual([]);
    await storage.close();
  });

  it("rotates oldest sealed turn families before newer ones", async () => {
    const nativeDatabase = new DatabaseSync(":memory:");
    nativeDatabase.exec(`CREATE TABLE "codewide_thread_details" (
      "__key" TEXT PRIMARY KEY NOT NULL,
      "__payload" TEXT NOT NULL,
      "connection_id" TEXT NOT NULL,
      "thread_id" TEXT NOT NULL,
      "turn_id" TEXT,
      "history_epoch" INTEGER NOT NULL,
      "kind" TEXT NOT NULL,
      "ordinal" REAL NOT NULL,
      "sealed" INTEGER NOT NULL
    )`);
    const insert = nativeDatabase.prepare(`INSERT INTO "codewide_thread_details"
      ("__key", "__payload", "connection_id", "thread_id", "turn_id", "history_epoch", "kind", "ordinal", "sealed")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (let ordinal = 1; ordinal <= 8; ordinal += 1) {
      const payload = JSON.stringify({ id: `turn-${ordinal}`, body: "x".repeat(160) });
      insert.run(`turn-${ordinal}`, payload, "server", "thread", `turn-${ordinal}`, 1, "turn", ordinal, 1);
      insert.run(`activity-${ordinal}`, payload, "server", "thread", `turn-${ordinal}`, 1, "activity", ordinal, 1);
    }
    nativeDatabase.exec(`CREATE TABLE "codewide_thread_detail_cache_meta" (
      "singleton" INTEGER PRIMARY KEY NOT NULL,
      "history_bytes" INTEGER NOT NULL
    )`);
    nativeDatabase.exec(`INSERT INTO "codewide_thread_detail_cache_meta" ("singleton", "history_bytes")
      SELECT 1, SUM(LENGTH(CAST("__payload" AS BLOB))) FROM "codewide_thread_details"`);
    const executor = {
      execute: async (sql: string, params: readonly unknown[] = []) => ({
        rows: nativeDatabase.prepare(sql).all(...params as []),
      }),
    };

    const result = await rotateHistoryCache(executor, {
      softLimitBytes: 900,
      hardLimitBytes: 1_200,
    });

    const remaining = nativeDatabase.prepare(
      `SELECT "ordinal" FROM "codewide_thread_details" WHERE "kind" = 'turn' ORDER BY "ordinal"`,
    ).all().map(({ ordinal }) => ordinal);
    expect(result.historyFamiliesEvicted).toBeGreaterThan(0);
    expect(remaining).toContain(8);
    expect(remaining).toContain(7);
    expect(remaining).not.toContain(1);
    expect(nativeDatabase.prepare(
      `SELECT COUNT(*) AS "count" FROM "codewide_thread_details" WHERE "ordinal" = 1`,
    ).get()).toMatchObject({ count: 0 });
    nativeDatabase.close();
  });

  it("maintains the history byte budget transactionally", async () => {
    const nativeDatabase = new DatabaseSync(":memory:");
    nativeDatabase.exec(`CREATE TABLE "codewide_thread_details" (
      "__key" TEXT PRIMARY KEY NOT NULL,
      "__payload" TEXT NOT NULL,
      "connection_id" TEXT NOT NULL,
      "thread_id" TEXT NOT NULL,
      "turn_id" TEXT,
      "history_epoch" INTEGER NOT NULL,
      "kind" TEXT NOT NULL,
      "ordinal" REAL NOT NULL,
      "sealed" INTEGER NOT NULL
    )`);
    const executor = {
      execute: async (sql: string, params: readonly unknown[] = []) => ({
        rows: nativeDatabase.prepare(sql).all(...params as []),
      }),
    };
    await prepareHistoryCacheAccounting(executor);
    const insert = nativeDatabase.prepare(`INSERT INTO "codewide_thread_details"
      ("__key", "__payload", "connection_id", "thread_id", "turn_id", "history_epoch", "kind", "ordinal", "sealed")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    insert.run("turn", "ёж", "server", "thread", "turn", 1, "turn", 1, 1);
    insert.run("pending", "ignored", "server", "thread", null, 1, "pending", 2, 0);
    expect(nativeDatabase.prepare(
      `SELECT "history_bytes" FROM "codewide_thread_detail_cache_meta"`,
    ).get()).toMatchObject({ history_bytes: Buffer.byteLength("ёж") });

    nativeDatabase.prepare(`UPDATE "codewide_thread_details" SET "__payload" = ? WHERE "__key" = 'turn'`).run("longer");
    expect(nativeDatabase.prepare(
      `SELECT "history_bytes" FROM "codewide_thread_detail_cache_meta"`,
    ).get()).toMatchObject({ history_bytes: Buffer.byteLength("longer") });
    nativeDatabase.prepare(`DELETE FROM "codewide_thread_details" WHERE "__key" = 'turn'`).run();
    expect(nativeDatabase.prepare(
      `SELECT "history_bytes" FROM "codewide_thread_detail_cache_meta"`,
    ).get()).toMatchObject({ history_bytes: 0 });
    nativeDatabase.close();
  });

  it("resolves an anchored resident window with one SQLite statement", async () => {
    const storage = createThreadDetailSqlite(() => undefined);
    await storage.prepare();
    sqlite.execute.mockClear();
    sqlite.database.transaction.mockClear();
    const turn = {
      id: "turn:server:thread:turn-7",
      kind: "turn",
      connectionId: "server",
      remoteThreadId: "thread",
      remoteTurnId: "turn-7",
      historyEpoch: 2,
      ordinal: 7,
      sealed: true,
    };
    sqlite.execute.mockResolvedValueOnce({ rows: [
      { bucket: "meta", __payload: null, history_epoch: 2, latest_ordinal: 12, earliest_ordinal: 1 },
      { bucket: "turn", __payload: JSON.stringify(turn), result_ordinal: 7 },
    ] });

    const loaded = await storage.loadResolvedWindow({
      connectionId: "server",
      threadId: "thread",
      anchorTurnId: "turn-4",
      turnLimit: 12,
      newerBuffer: 6,
    });

    expect(sqlite.execute).toHaveBeenCalledTimes(1);
    expect(sqlite.execute).toHaveBeenCalledWith(
      expect.stringContaining('WITH\n      "args"'),
      ["server", "thread", "turn-4", 12, 6],
    );
    expect(loaded).toMatchObject({
      historyEpoch: 2,
      latestSealedOrdinal: 12,
      earliestSealedOrdinal: 1,
      turnRows: [expect.objectContaining({ id: "turn:server:thread:turn-7", ordinal: 7 })],
      detailRows: [],
      liveRows: [],
    });

    const statement = sqlite.execute.mock.calls[0]?.[0] as string;
    const params = sqlite.execute.mock.calls[0]?.[1] as readonly (string | number | null)[];
    const nativeDatabase = new DatabaseSync(":memory:");
    nativeDatabase.exec(`CREATE TABLE "codewide_thread_details" (
      "__key" TEXT PRIMARY KEY NOT NULL,
      "__payload" TEXT NOT NULL,
      "connection_id" TEXT NOT NULL,
      "thread_id" TEXT NOT NULL,
      "turn_id" TEXT,
      "history_epoch" INTEGER NOT NULL,
      "kind" TEXT NOT NULL,
      "ordinal" REAL NOT NULL,
      "sealed" INTEGER NOT NULL
    )`);
    const insert = nativeDatabase.prepare(`INSERT INTO "codewide_thread_details"
      ("__key", "__payload", "connection_id", "thread_id", "turn_id", "history_epoch", "kind", "ordinal", "sealed")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    insert.run("meta", JSON.stringify({ id: "meta", historyEpoch: 2 }), "server", "thread", null, 2, "thread", -1, 1);
    for (let ordinal = 1; ordinal <= 12; ordinal += 1) {
      insert.run(
        `turn-${ordinal}`,
        JSON.stringify({ id: `turn-${ordinal}`, kind: "turn", ordinal }),
        "server",
        "thread",
        `turn-${ordinal}`,
        2,
        "turn",
        ordinal,
        1,
      );
    }
    insert.run("activity-4", JSON.stringify({ id: "activity-4", kind: "activity", ordinal: 4 }), "server", "thread", "turn-4", 2, "activity", 4, 1);
    insert.run("queued", JSON.stringify({
      id: "queued",
      kind: "pending",
      ordinal: 13,
      pending: { presentation: "queue" },
    }), "server", "thread", null, 2, "pending", 13, 0);
    insert.run("delivery", JSON.stringify({
      id: "delivery",
      kind: "pending",
      ordinal: 14,
      pending: { presentation: "delivery" },
    }), "server", "thread", null, 2, "pending", 14, 0);

    const actualRows = nativeDatabase.prepare(statement).all(...params) as Array<Record<string, unknown>>;
    expect(actualRows.find(({ bucket }) => bucket === "meta")).toMatchObject({
      history_epoch: 2,
      latest_ordinal: 12,
      earliest_ordinal: 1,
    });
    expect(actualRows.filter(({ bucket }) => bucket === "turn")).toHaveLength(10);
    expect(actualRows.filter(({ bucket }) => bucket === "detail")).toHaveLength(1);
    expect(actualRows.filter(({ bucket }) => bucket === "live")).toHaveLength(2);
    nativeDatabase.close();
    await storage.close();
  });
});
