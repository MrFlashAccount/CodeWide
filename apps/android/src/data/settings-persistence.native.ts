import { open } from "@op-engineering/op-sqlite";
import { wrapSqliteDatabase, type SqliteDatabase, type SqliteDatabaseLike } from "@codewide/tanstack-db-sqlite";

let settingsDatabase: SqliteDatabase | null = null;

/** Durable device-wide metadata database. Credentials remain Android
 * Keystore-owned; reconstructable server data belongs in the UI cache. */
export function getSettingsSqliteDatabase(): SqliteDatabase {
  if (settingsDatabase !== null) return settingsDatabase;
  const database = open({ name: "codex-remote-settings.db", location: "settings" });
  settingsDatabase = wrapSqliteDatabase(database as unknown as SqliteDatabaseLike);
  return settingsDatabase;
}
