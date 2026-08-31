import type { SqliteDatabase, SqliteExecutor } from "@codewide/tanstack-db-sqlite";

/**
 * op-sqlite exposes one transaction slot per native database. V2 has several
 * independent durable stores sharing that slot, so their transactions must be
 * sequenced at the database boundary rather than independently inside a store.
 */
export function serializeSqliteTransactions(database: SqliteDatabase): SqliteDatabase {
  let tail = Promise.resolve();

  return {
    execute: (sql, params) => database.execute(sql, params),
    transaction<T>(operation: (executor: SqliteExecutor) => Promise<T>): Promise<T> {
      const run = tail.then(() => database.transaction(operation));
      tail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}
