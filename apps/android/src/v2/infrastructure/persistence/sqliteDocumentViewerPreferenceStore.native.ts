import type { SqliteDatabase, SqliteValue } from "@codewide/tanstack-db-sqlite";

import type { DocumentViewerPreferenceStore } from "../../application/ports/documentViewerPreferenceStore";
import { documentViewerPreferences } from "../../application/documentViewerPreferences";
import { getV2SqliteDatabase } from "./v2Database.native";

const TABLE = "codewide_v2_document_viewer_preferences";

export function createDocumentViewerPreferenceStore(): DocumentViewerPreferenceStore {
  return createDocumentViewerPreferenceStoreWithDatabase(getV2SqliteDatabase());
}

/** @testOnly Injects an isolated database into persistence regressions. */
export function createDocumentViewerPreferenceStoreWithDatabase(
  database: SqliteDatabase,
): DocumentViewerPreferenceStore {
  let prepared: Promise<void> | null = null;
  const prepare = async (): Promise<void> => {
    prepared ??= database.transaction(async (executor) => {
      await executor.execute(
        `CREATE TABLE IF NOT EXISTS ${TABLE} (` +
          "id INTEGER PRIMARY KEY CHECK(id = 1), layout_mode TEXT NOT NULL, text_scale REAL NOT NULL)",
      );
    });
    await prepared;
  };
  return {
    async load() {
      await prepare();
      return database.transaction(async (executor) => {
        const result = await executor.execute(
          `SELECT layout_mode, text_scale FROM ${TABLE} WHERE id = 1`,
        );
        const row = extractRow(result);
        if (row === null) return null;
        const layoutMode = row.layout_mode;
        const textScale = row.text_scale;
        if ((layoutMode !== "reading" && layoutMode !== "wide") || typeof textScale !== "number")
          return null;
        return documentViewerPreferences(layoutMode, textScale);
      });
    },
    async save(preferences) {
      await prepare();
      await database.transaction(async (executor) => {
        await executor.execute(
          `INSERT OR REPLACE INTO ${TABLE}(id, layout_mode, text_scale) VALUES (1, ?, ?)`,
          [preferences.layoutMode, preferences.textScale],
        );
      });
    },
  };
}

function extractRow(result: unknown): Record<string, SqliteValue> | null {
  const rows = Array.isArray(result)
    ? result
    : typeof result === "object" && result !== null
      ? Reflect.get(result, "rows")
      : null;
  if (!Array.isArray(rows)) return null;
  const row: unknown = rows[0];
  return isSqliteRow(row) ? row : null;
}

function isSqliteRow(value: unknown): value is Record<string, SqliteValue> {
  return typeof value === "object" && value !== null;
}
