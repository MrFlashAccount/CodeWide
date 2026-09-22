import { getUiCacheSqliteDatabase } from "./ui-cache-persistence.native";
import { unknownRecord } from "./unknownRecord";

let ready: Promise<unknown> | null = null;
async function database() {
  const value = getUiCacheSqliteDatabase();
  ready ??= value.execute(
    "CREATE TABLE IF NOT EXISTS codewide_question_drafts (id TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );
  await ready;
  return value;
}
/** Reads one local question draft; the feature validates the serialized form. */
export async function readQuestionDraft(key: string): Promise<string | null> {
  const db = await database();
  const result = unknownRecord(
    await db.execute("SELECT value FROM codewide_question_drafts WHERE id = ?", [key]),
  );
  const rows: unknown = result?.rows;
  const row = Array.isArray(rows) ? unknownRecord(rows[0]) : null;
  return typeof row?.value === "string" ? row.value : null;
}
/** Persists only the feature's sanitized draft, independently of the main composer. */
export async function writeQuestionDraft(key: string, value: string): Promise<void> {
  const db = await database();
  await db.execute(
    "INSERT INTO codewide_question_drafts (id, value) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}
