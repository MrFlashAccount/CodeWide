import { open } from "@op-engineering/op-sqlite";
import { wrapSqliteDatabase, type SqliteDatabase } from "@codewide/tanstack-db-sqlite";

import { serializeSqliteTransactions } from "./serialSqliteDatabase";

let database: SqliteDatabase | null = null;

/** The V2 replica, operation journal, and deletion intents never share V1 storage. */
export function getV2SqliteDatabase(): SqliteDatabase {
  if (database !== null) {
    return database;
  }
  const nativeDatabase = open({ location: "v2", name: "codewide-v2.db" });
  database = serializeSqliteTransactions(wrapSqliteDatabase(nativeDatabase));
  return database;
}
