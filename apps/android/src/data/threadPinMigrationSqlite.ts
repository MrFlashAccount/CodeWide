import type { SqliteExecutor } from "@codewide/tanstack-db-sqlite";
import { sqliteRows } from "./sqliteResult";

const TABLE = "codewide_legacy_thread_pins";

/** Captures retired device pins before their display flags are cleared, in the caller's transaction. */
export async function captureLegacyThreadPins(executor: SqliteExecutor): Promise<void> {
  await executor.execute(`CREATE TABLE IF NOT EXISTS ${TABLE} (
    connection_id TEXT NOT NULL, thread_id TEXT NOT NULL,
    PRIMARY KEY (connection_id, thread_id))`);
  await executor.execute(`INSERT OR IGNORE INTO ${TABLE} (connection_id, thread_id)
    SELECT connection_id, thread_id FROM codewide_thread_summaries
    WHERE pinned = 1 AND json_type(__payload, '$.pinCursor') IS NULL`);
}

/** Keeps pending imports independent of catalog eviction and scoped to their owning Companion. */
export async function loadLegacyThreadPins(
  executor: SqliteExecutor,
  connectionId: string,
): Promise<readonly string[]> {
  const rows = sqliteRows(
    await executor.execute(
      `SELECT thread_id FROM ${TABLE} WHERE connection_id = ? ORDER BY thread_id`,
      [connectionId],
    ),
  );
  return rows.map((row) => {
    if (
      typeof row.thread_id !== "string" ||
      row.thread_id.length === 0 ||
      row.thread_id.trim() !== row.thread_id
    ) {
      throw new Error("Invalid legacy pinned thread identity");
    }
    return row.thread_id;
  });
}

/** Removes only the batch acknowledged by Companion; a failed request leaves it available for retry. */
export async function acknowledgeLegacyThreadPins(
  executor: SqliteExecutor,
  connectionId: string,
  threadIds: readonly string[],
): Promise<void> {
  for (const threadId of threadIds) {
    await executor.execute(`DELETE FROM ${TABLE} WHERE connection_id = ? AND thread_id = ?`, [
      connectionId,
      threadId,
    ]);
  }
}
