import {
  v2SavedServerId,
  type V2SavedServerDeletionStore,
  type V2SavedServerId,
} from "@codewide/sync-client/v2";
import type { SqliteDatabase, SqliteValue } from "@codewide/tanstack-db-sqlite";

import { getV2SqliteDatabase } from "./v2Database.native";

const TABLE = "codewide_sync_v2_saved_server_delete_intents";

export function createNativeSyncV2SavedServerDeletionStore(): V2SavedServerDeletionStore {
  return createNativeSyncV2SavedServerDeletionStoreWithDatabase(getV2SqliteDatabase());
}

export function createNativeSyncV2SavedServerDeletionStoreWithDatabase(
  database: SqliteDatabase,
): V2SavedServerDeletionStore {
  let prepared: Promise<void> | null = null;
  const prepare = async (): Promise<void> => {
    prepared ??= database.transaction(async (executor) => {
      await executor.execute(
        `CREATE TABLE IF NOT EXISTS ${TABLE} (saved_server_id TEXT NOT NULL PRIMARY KEY)`,
      );
    });
    return prepared;
  };
  return {
    async begin(savedServerId) {
      await prepare();
      await database.transaction(async (executor) => {
        await executor.execute(`INSERT OR IGNORE INTO ${TABLE}(saved_server_id) VALUES (?)`, [
          savedServerId,
        ]);
      });
    },
    async complete(savedServerId) {
      await prepare();
      await database.transaction(async (executor) => {
        await executor.execute(`DELETE FROM ${TABLE} WHERE saved_server_id = ?`, [savedServerId]);
      });
    },
    async listPending() {
      await prepare();
      return database.transaction(async (executor) => {
        const rows = extractRows(
          await executor.execute(`SELECT saved_server_id FROM ${TABLE} ORDER BY saved_server_id`),
        );
        return rows.flatMap((row): V2SavedServerId[] =>
          typeof row.saved_server_id === "string" ? [v2SavedServerId(row.saved_server_id)] : [],
        );
      });
    },
    async pending(savedServerId) {
      await prepare();
      return database.transaction(async (executor) => {
        const rows = extractRows(
          await executor.execute(
            `SELECT saved_server_id FROM ${TABLE} WHERE saved_server_id = ? LIMIT 1`,
            [savedServerId],
          ),
        );
        return rows.length > 0;
      });
    },
  };
}

function extractRows(result: unknown): readonly Record<string, SqliteValue>[] {
  if (Array.isArray(result)) {
    return result as readonly Record<string, SqliteValue>[];
  }
  if (typeof result !== "object" || result === null) {
    return [];
  }
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as readonly Record<string, SqliteValue>[]) : [];
}
