import type { SqliteDatabase, SqliteValue } from "@codewide/tanstack-db-sqlite";

import type { ThreadPinRecord, ThreadPinStore } from "../../application/ports/threadPinStore";
import { savedServerId, threadId } from "../../domain/ids";
import { getV2SqliteDatabase } from "./v2Database.native";

const TABLE = "codewide_v2_thread_pins";

export function createThreadPinStore(): ThreadPinStore {
  return createThreadPinStoreWithDatabase(getV2SqliteDatabase());
}

/** @testOnly Injects an isolated database into persistence regression tests. */
export function createThreadPinStoreWithDatabase(database: SqliteDatabase): ThreadPinStore {
  let prepared: Promise<void> | null = null;
  const prepare = async (): Promise<void> => {
    prepared ??= database.transaction(async (executor) => {
      await executor.execute(
        `CREATE TABLE IF NOT EXISTS ${TABLE} (` +
          "saved_server_id TEXT NOT NULL, thread_id TEXT NOT NULL, " +
          "PRIMARY KEY(saved_server_id, thread_id))",
      );
    });
    await prepared;
  };
  return {
    async deleteSavedServer(id) {
      await prepare();
      await database.transaction(async (executor) => {
        await executor.execute(`DELETE FROM ${TABLE} WHERE saved_server_id = ?`, [id]);
      });
    },
    async list() {
      await prepare();
      return database.transaction(async (executor) => {
        const result = await executor.execute(
          `SELECT saved_server_id, thread_id FROM ${TABLE} ` +
            "ORDER BY saved_server_id ASC, thread_id ASC",
        );
        const records: ThreadPinRecord[] = [];
        for (const row of extractRows(result)) {
          const record = parseRecord(row);
          if (record !== null) records.push(record);
        }
        return records;
      });
    },
    async setPinned(server, thread, pinned) {
      await prepare();
      await database.transaction(async (executor) => {
        if (pinned) {
          await executor.execute(
            `INSERT OR IGNORE INTO ${TABLE}(saved_server_id, thread_id) VALUES (?, ?)`,
            [server, thread],
          );
          return;
        }
        await executor.execute(`DELETE FROM ${TABLE} WHERE saved_server_id = ? AND thread_id = ?`, [
          server,
          thread,
        ]);
      });
    },
  };
}

function extractRows(result: unknown): readonly Record<string, SqliteValue>[] {
  if (Array.isArray(result)) return result.filter(isSqliteRow);
  if (typeof result !== "object" || result === null) return [];
  const rows = Reflect.get(result, "rows");
  return Array.isArray(rows) ? rows.filter(isSqliteRow) : [];
}

function isSqliteRow(value: unknown): value is Record<string, SqliteValue> {
  return typeof value === "object" && value !== null;
}

function parseRecord(row: Record<string, SqliteValue>): ThreadPinRecord | null {
  const server = row.saved_server_id;
  const thread = row.thread_id;
  if (typeof server !== "string" || typeof thread !== "string") return null;
  try {
    return { savedServerId: savedServerId(server), threadId: threadId(thread) };
  } catch {
    return null;
  }
}
