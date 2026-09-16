import type { SqliteValue } from "@codewide/tanstack-db-sqlite";

import { unknownRecord } from "./unknownRecord";

/** Validates the intentionally loose result shape shared by the native SQLite adapters. */
export function sqliteRows(result: unknown): readonly Record<string, SqliteValue>[] {
  const rows = Array.isArray(result) ? result : unknownRecord(result)?.rows;
  return Array.isArray(rows) ? rows.filter(isSqliteRow) : [];
}

function isSqliteRow(value: unknown): value is Record<string, SqliteValue> {
  const row = unknownRecord(value);
  return row !== null && Object.values(row).every(isSqliteValue);
}

function isSqliteValue(value: unknown): value is SqliteValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    Object.prototype.toString.call(value) === "[object ArrayBuffer]" ||
    ArrayBuffer.isView(value)
  );
}
