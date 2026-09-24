import { getUiCacheSqliteDatabase } from "./ui-cache-persistence.native";
import { unknownRecord } from "./unknownRecord";

let ready: Promise<unknown> | null = null;
let pendingWrites = Promise.resolve();
const deletedPrefixes = new Set<string>();

function isDeletedKey(key: string): boolean {
  for (const prefix of deletedPrefixes) {
    if (key.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

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
  if (isDeletedKey(key)) {
    return null;
  }
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
  const write = pendingWrites.then(async () => {
    if (!isDeletedKey(key)) {
      await db.execute(
        "INSERT INTO codewide_question_drafts (id, value) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value",
        [key, value],
      );
    }
  });
  pendingWrites = write.catch(() => undefined);
  await write;
}

/** Question keys begin with a JSON-encoded connection id. */
export async function deleteConnectionQuestionDrafts(connectionId: string): Promise<void> {
  const prefix = `[${JSON.stringify(connectionId)},`;
  deletedPrefixes.add(prefix);
  const db = await database();
  await pendingWrites;
  await db.execute("DELETE FROM codewide_question_drafts WHERE substr(id, 1, length(?)) = ?", [
    prefix,
    prefix,
  ]);
}
