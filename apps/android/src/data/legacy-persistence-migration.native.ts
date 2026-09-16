import type { SqliteExecutor } from "@codewide/tanstack-db-sqlite";

import { sqliteRows } from "./sqliteResult";
import { unknownRecord } from "./unknownRecord";

const TYPE_TAG = "__tanstack_db_persisted_type__";
const VALUE_TAG = "value";

/** Read-only bridge for databases written by the former TanStack persistence
 * adapter. It is used only by one-shot model bootstraps; it never owns sync. */
export async function readLegacyPersistedRows<T extends Record<string, unknown>>(
  executor: SqliteExecutor,
  collectionId: string,
): Promise<T[]> {
  const registry = await executor.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'collection_registry'",
  );
  if (sqliteRows(registry).length === 0) {
    return [];
  }
  const mapping = await executor.execute(
    "SELECT table_name FROM collection_registry WHERE collection_id = ? LIMIT 1",
    [collectionId],
  );
  const tableName = sqliteRows(mapping)[0]?.table_name;
  if (typeof tableName !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(tableName)) {
    return [];
  }
  const rows = await executor.execute(`SELECT value FROM "${tableName}"`);
  return sqliteRows(rows).flatMap((row) => {
    if (typeof row.value !== "string") {
      return [];
    }
    try {
      const decoded = decodePersistedJsonValue(JSON.parse(row.value));
      const record = unknownRecord(decoded);
      if (record === null) {
        return [];
      }
      return [legacyRow<T>(record)];
    } catch {
      // Obsolete, corrupt cache rows are not allowed to keep the current
      // model in an infinite initial-hydration retry. Valid rows still migrate.
      return [];
    }
  });
}

// WHY: T carries the caller-owned collection contract across this one-shot legacy boundary; removing it would widen every migrated row to an untyped record.
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
function legacyRow<T extends Record<string, unknown>>(record: Record<string, unknown>): T {
  // WHY: These rows were written by the same typed collection before its adapter changed; the generic bridge cannot recover T from the validated record without an assertion or duplicating every current collection schema.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return record as T;
}

function decodePersistedJsonValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(decodePersistedJsonValue);
  }
  if (typeof value !== "object") {
    return value;
  }
  const record = unknownRecord(value);
  if (record === null) {
    return value;
  }
  if (typeof record[TYPE_TAG] === "string" && typeof record[VALUE_TAG] === "string") {
    switch (record[TYPE_TAG]) {
      case "bigint":
        return BigInt(record[VALUE_TAG]);
      case "date": {
        const date = new Date(record[VALUE_TAG]);
        return Number.isNaN(date.getTime()) ? null : date;
      }
      case "nan":
        return Number.NaN;
      case "infinity":
        return Number.POSITIVE_INFINITY;
      case "-infinity":
        return Number.NEGATIVE_INFINITY;
    }
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [key, decodePersistedJsonValue(entry)]),
  );
}
