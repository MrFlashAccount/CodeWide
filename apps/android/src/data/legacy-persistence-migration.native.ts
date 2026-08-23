import type { SqliteExecutor, SqliteValue } from "@codewide/tanstack-db-sqlite";

const TYPE_TAG = "__tanstack_db_persisted_type__";
const VALUE_TAG = "value";

/** Read-only bridge for databases written by the former TanStack persistence
 * adapter. It is used only by one-shot model bootstraps; it never owns sync. */
export async function readLegacyPersistedRows<T extends object>(
  executor: SqliteExecutor,
  collectionId: string,
): Promise<T[]> {
  const registry = await executor.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'collection_registry'",
  );
  if (extractRows(registry).length === 0) return [];
  const mapping = await executor.execute(
    "SELECT table_name FROM collection_registry WHERE collection_id = ? LIMIT 1",
    [collectionId],
  );
  const tableName = extractRows(mapping)[0]?.table_name;
  if (typeof tableName !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(tableName)) return [];
  const rows = await executor.execute(`SELECT value FROM "${tableName}"`);
  return extractRows(rows).flatMap((row) => {
    if (typeof row.value !== "string") return [];
    try {
      return [decodePersistedJsonValue(JSON.parse(row.value)) as T];
    } catch {
      // Obsolete, corrupt cache rows are not allowed to keep the current
      // model in an infinite initial-hydration retry. Valid rows still migrate.
      return [];
    }
  });
}

function extractRows(result: unknown): readonly Record<string, SqliteValue>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? rows as readonly Record<string, SqliteValue>[] : [];
}

function decodePersistedJsonValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(decodePersistedJsonValue);
  if (typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (typeof record[TYPE_TAG] === "string" && typeof record[VALUE_TAG] === "string") {
    switch (record[TYPE_TAG]) {
      case "bigint": return BigInt(record[VALUE_TAG]);
      case "date": {
        const date = new Date(record[VALUE_TAG]);
        return Number.isNaN(date.getTime()) ? null : date;
      }
      case "nan": return Number.NaN;
      case "infinity": return Number.POSITIVE_INFINITY;
      case "-infinity": return Number.NEGATIVE_INFINITY;
    }
  }
  return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, decodePersistedJsonValue(entry)]));
}
