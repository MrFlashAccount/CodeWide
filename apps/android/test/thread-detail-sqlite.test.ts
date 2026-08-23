import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";

const sqlite = vi.hoisted(() => {
  const insertedRows: unknown[][] = [];
  const legacyRow = {
    id: "turn:server:thread:turn-1",
    kind: "turn",
    connectionId: "server",
    remoteThreadId: "thread",
    remoteTurnId: "turn-1",
    sessionId: null,
    lastOpenedAt: 10,
    thread: null,
    turn: { id: "turn-1", status: "completed", items: [] },
    turnMetadata: null,
    activityItems: null,
  };
  const execute = vi.fn(async (sql: string, params: readonly unknown[] = []) => {
    if (sql.includes("sqlite_master")) return { rows: [{ name: "collection_registry" }] };
    if (sql.includes("FROM collection_registry")) return { rows: [{ table_name: "c_thread_details" }] };
    if (sql.includes('SELECT value FROM "c_thread_details"')) {
      return { rows: [{ value: JSON.stringify(legacyRow) }] };
    }
    if (sql.includes('SELECT COUNT(*) AS "row_count"')) return { rows: [{ row_count: 0 }] };
    if (sql.includes('SELECT 1 AS "present"')) return { rows: [] };
    if (sql.includes('INSERT INTO "codewide_thread_details"')) insertedRows.push([...params]);
    return { rows: [] };
  });
  const database = {
    execute,
    transaction: vi.fn(async <T>(operation: (executor: { execute: typeof execute }) => Promise<T>) => await operation({ execute })),
  };
  return { database, execute, insertedRows };
});

vi.mock("../src/data/ui-cache-persistence.native", () => ({
  getUiCacheSqliteDatabase: () => sqlite.database,
}));

import { createThreadDetailSqlite } from "../src/data/thread-detail-sqlite.native";

describe("thread detail SQLite bootstrap", () => {
  beforeEach(() => {
    sqlite.execute.mockClear();
    sqlite.database.transaction.mockClear();
    sqlite.insertedRows.length = 0;
  });

  it("imports the former TanStack collection before marking the direct model ready", async () => {
    const storage = createThreadDetailSqlite(() => undefined);
    await storage.prepare();

    expect(sqlite.insertedRows).toHaveLength(1);
    expect(JSON.parse(sqlite.insertedRows[0]?.[1] as string)).toMatchObject({
      id: "turn:server:thread:turn-1",
      historyEpoch: 0,
      ordinal: 0,
      sealed: true,
    });
    expect(sqlite.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO "__tanstack_db_sqlite_bootstrap"'),
      ["thread-details-v2", "tanstack-persistence:thread-details-v2:v1"],
    );
    await storage.close();
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
      { bucket: "meta", __payload: null, history_epoch: 2, latest_ordinal: 12, earliest_ordinal: 1, requested_max_ordinal: 10 },
      { bucket: "turn", __payload: JSON.stringify(turn), result_ordinal: 7 },
    ] });

    const loaded = await storage.loadResolvedWindow({
      connectionId: "server",
      threadId: "thread",
      anchorTurnId: "turn-4",
      residentHistoryEpoch: null,
      residentMaxOrdinal: undefined,
      residentTurnLimit: 12,
      restoreNewerBuffer: 6,
    });

    expect(sqlite.execute).toHaveBeenCalledTimes(1);
    expect(sqlite.execute).toHaveBeenCalledWith(
      expect.stringContaining('WITH\n      "args"'),
      ["server", "thread", "turn-4", null, null, 0, 12, 6],
    );
    expect(loaded).toMatchObject({
      historyEpoch: 2,
      latestSealedOrdinal: 12,
      earliestSealedOrdinal: 1,
      requestedMaxOrdinal: 10,
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
    insert.run("pending", JSON.stringify({ id: "pending", kind: "pending", ordinal: 13 }), "server", "thread", null, 2, "pending", 13, 0);

    const actualRows = nativeDatabase.prepare(statement).all(...params) as Array<Record<string, unknown>>;
    expect(actualRows.find(({ bucket }) => bucket === "meta")).toMatchObject({
      history_epoch: 2,
      latest_ordinal: 12,
      earliest_ordinal: 1,
      requested_max_ordinal: 10,
    });
    expect(actualRows.filter(({ bucket }) => bucket === "turn")).toHaveLength(10);
    expect(actualRows.filter(({ bucket }) => bucket === "detail")).toHaveLength(1);
    expect(actualRows.filter(({ bucket }) => bucket === "live")).toHaveLength(1);
    nativeDatabase.close();
    await storage.close();
  });
});
