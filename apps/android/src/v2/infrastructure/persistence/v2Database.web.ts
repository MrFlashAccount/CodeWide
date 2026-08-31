import type { SqliteDatabase } from "@codewide/tanstack-db-sqlite";

export function getV2SqliteDatabase(): SqliteDatabase {
  throw new Error("The web V2 runtime uses its in-memory stores");
}
