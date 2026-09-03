import type { SqliteDatabase, SqliteValue } from "@codewide/tanstack-db-sqlite";

import type {
  TerminalSessionRecord,
  TerminalSessionStore,
} from "../../application/ports/terminalSessionStore";
import { savedServerId, threadId } from "../../domain/ids";
import { qualifiedThread } from "../../domain/qualifiedThread";
import { getV2SqliteDatabase } from "./v2Database.native";

const TABLE = "codewide_v2_terminal_sessions";

export function createTerminalSessionStore(): TerminalSessionStore {
  return createTerminalSessionStoreWithDatabase(getV2SqliteDatabase());
}

/** @testOnly Injects an isolated database into persistence regression tests. */
export function createTerminalSessionStoreWithDatabase(
  database: SqliteDatabase,
): TerminalSessionStore {
  let prepared: Promise<void> | null = null;
  const prepare = async (): Promise<void> => {
    prepared ??= database.transaction(async (executor) => {
      await executor.execute(
        `CREATE TABLE IF NOT EXISTS ${TABLE} (` +
          "session_id TEXT PRIMARY KEY NOT NULL, saved_server_id TEXT NOT NULL, " +
          "thread_id TEXT NOT NULL, generation TEXT NOT NULL, cwd TEXT, " +
          "cols INTEGER NOT NULL, rows INTEGER NOT NULL, title TEXT NOT NULL)",
      );
      await executor.execute(
        `CREATE INDEX IF NOT EXISTS ${TABLE}_server ON ${TABLE}(saved_server_id)`,
      );
    });
    await prepared;
  };
  return {
    async delete(id) {
      await prepare();
      await database.transaction(async (executor) => {
        await executor.execute(`DELETE FROM ${TABLE} WHERE session_id = ?`, [id]);
      });
    },
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
          `SELECT session_id, saved_server_id, thread_id, generation, cwd, cols, rows, title ` +
            `FROM ${TABLE} ORDER BY saved_server_id ASC, thread_id ASC, title ASC`,
        );
        const records: TerminalSessionRecord[] = [];
        for (const row of extractRows(result)) {
          const record = parseRecord(row);
          if (record === null) {
            const id = row.session_id;
            if (typeof id === "string")
              await executor.execute(`DELETE FROM ${TABLE} WHERE session_id = ?`, [id]);
          } else {
            records.push(record);
          }
        }
        return records;
      });
    },
    async upsert(record) {
      await prepare();
      await database.transaction(async (executor) => {
        await executor.execute(
          `INSERT OR REPLACE INTO ${TABLE}(` +
            "session_id, saved_server_id, thread_id, generation, cwd, cols, rows, title) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [
            record.id,
            record.owner.savedServerId,
            record.owner.threadId,
            record.generation,
            record.cwd,
            record.cols,
            record.rows,
            record.title,
          ],
        );
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

function parseRecord(row: Record<string, SqliteValue>): TerminalSessionRecord | null {
  const id = row.session_id;
  const server = row.saved_server_id;
  const thread = row.thread_id;
  const generation = row.generation;
  const cwd = row.cwd;
  const cols = row.cols;
  const rows = row.rows;
  const title = row.title;
  if (
    typeof id !== "string" ||
    typeof server !== "string" ||
    typeof thread !== "string" ||
    typeof generation !== "string" ||
    !/^(0|[1-9][0-9]*)$/.test(generation) ||
    (cwd !== null && typeof cwd !== "string") ||
    typeof cols !== "number" ||
    !Number.isInteger(cols) ||
    cols < 2 ||
    cols > 500 ||
    typeof rows !== "number" ||
    !Number.isInteger(rows) ||
    rows < 2 ||
    rows > 300 ||
    typeof title !== "string" ||
    title.length === 0
  )
    return null;
  try {
    return {
      cols,
      cwd,
      generation,
      id,
      owner: qualifiedThread(savedServerId(server), threadId(thread)),
      rows,
      title,
    };
  } catch {
    return null;
  }
}
