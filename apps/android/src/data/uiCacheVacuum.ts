import type { SqliteDatabaseLike } from "@codewide/tanstack-db-sqlite";
import { appLogger } from "../observability/logger";
import { sqliteRows } from "./sqliteResult";
import type { RecoverableUiCacheConnection } from "./uiCacheConnection";

type Executor = Pick<SqliteDatabaseLike, "execute">;

/** Connection capability that runs a statement synchronously before consumers can use it. */
export type UiCacheConnectionSetup = {
  readonly executeSync: (sql: string) => unknown;
};

/** Vacuum maintenance for the shared UI cache database file. */
export type UiCacheVacuum = {
  /**
   * Converts a database created without auto-vacuum with one full `VACUUM`.
   * Call it only at an idle point: it holds the connection exclusively for
   * roughly 3 ms per MiB of database on desktop storage. A busy connection
   * leaves the migration for the next idle point; a failed `VACUUM` rejects
   * once and is not retried in this process.
   */
  readonly migrateAtIdle: () => Promise<void>;
  /**
   * Returns free pages to the filesystem in bounded incremental-vacuum steps.
   * Concurrent requests share one run, which rejects when a step fails.
   */
  readonly reclaimFreePages: () => Promise<void>;
};

type MigrationOutcome =
  | { readonly status: "current" }
  | {
      readonly bytesAfter: number;
      readonly bytesBefore: number;
      readonly durationMs: number;
      readonly status: "migrated";
    };

const AUTO_VACUUM_INCREMENTAL = 2;
const REQUEST_INCREMENTAL_AUTO_VACUUM = "PRAGMA auto_vacuum = INCREMENTAL";
// 512 pages (2 MiB at the default 4 KiB page size) took 10-25 ms per step on
// desktop storage; each step is its own transaction so consumers interleave.
const RECLAIM_PAGES_PER_STEP = 512;

/**
 * Requests incremental auto-vacuum on a newly opened connection. SQLite
 * applies it immediately only while the database has no tables, so every
 * open requests it before consumers prepare their schema; an existing
 * database keeps its mode until {@link UiCacheVacuum.migrateAtIdle} runs.
 */
export function requestIncrementalAutoVacuum(connection: UiCacheConnectionSetup): void {
  connection.executeSync(REQUEST_INCREMENTAL_AUTO_VACUUM);
}

/** Creates the process owner of vacuum maintenance for one shared connection. */
export function createUiCacheVacuum(connection: RecoverableUiCacheConnection): UiCacheVacuum {
  let migrationSettled = false;
  let migration: Promise<void> | null = null;
  let reclaim: Promise<void> | null = null;
  let reclaimRequested = false;

  const migrateOnce = async (): Promise<void> => {
    // A failed VACUUM (for example, no space for its copy) rolls back. Do not
    // repeat the full-file cost in this process; the next start retries.
    const outcome = await connection
      .runExclusive(migrateToIncrementalAutoVacuum)
      .catch((error: unknown) => {
        migrationSettled = true;
        throw error;
      });
    if (outcome.status === "busy") {
      return;
    }
    migrationSettled = true;
    if (outcome.value.status === "migrated") {
      appLogger.info({
        event: "ui_cache.auto_vacuum_migrated",
        fields: {
          bytesAfter: outcome.value.bytesAfter,
          bytesBefore: outcome.value.bytesBefore,
          durationMs: Math.round(outcome.value.durationMs),
        },
      });
    }
  };

  const reclaimUntilDrained = async (): Promise<void> => {
    while (reclaimRequested) {
      reclaimRequested = false;
      await reclaimFreePages(connection);
    }
  };

  return {
    migrateAtIdle: async () => {
      if (migrationSettled) {
        return;
      }
      migration ??= migrateOnce().finally(() => {
        migration = null;
      });
      await migration;
    },
    reclaimFreePages: async () => {
      reclaimRequested = true;
      reclaim ??= reclaimUntilDrained().finally(() => {
        reclaim = null;
      });
      await reclaim;
    },
  };
}

async function migrateToIncrementalAutoVacuum(executor: Executor): Promise<MigrationOutcome> {
  if ((await readPragma(executor, "auto_vacuum")) === AUTO_VACUUM_INCREMENTAL) {
    return { status: "current" };
  }
  const bytesBefore = await readDatabaseBytes(executor);
  const startedAt = performance.now();
  // The requested mode is held by this connection and applied by VACUUM.
  await executor.execute(REQUEST_INCREMENTAL_AUTO_VACUUM);
  await executor.execute("VACUUM");
  const durationMs = performance.now() - startedAt;
  const mode = await readPragma(executor, "auto_vacuum");
  if (mode !== AUTO_VACUUM_INCREMENTAL) {
    throw new Error(`UI cache auto_vacuum is ${String(mode)} after VACUUM`);
  }
  return {
    bytesAfter: await readDatabaseBytes(executor),
    bytesBefore: bytesBefore,
    durationMs: durationMs,
    status: "migrated",
  };
}

async function reclaimFreePages(connection: SqliteDatabaseLike): Promise<void> {
  for (;;) {
    let freedPages = 0;
    let remainingPages = 0;
    await connection.transaction(async (executor) => {
      const freePages = await readPragma(executor, "freelist_count");
      if (freePages > 0) {
        await executor.execute(`PRAGMA incremental_vacuum(${String(RECLAIM_PAGES_PER_STEP)})`);
      }
      remainingPages = await readPragma(executor, "freelist_count");
      freedPages = freePages - remainingPages;
    });
    // A database still awaiting migration frees nothing; stop instead of spinning.
    if (remainingPages === 0 || freedPages <= 0) {
      return;
    }
  }
}

async function readDatabaseBytes(executor: Executor): Promise<number> {
  return (await readPragma(executor, "page_count")) * (await readPragma(executor, "page_size"));
}

async function readPragma(
  executor: Executor,
  name: "auto_vacuum" | "freelist_count" | "page_count" | "page_size",
): Promise<number> {
  const value = sqliteRows(await executor.execute(`PRAGMA ${name}`))[0]?.[name];
  if (typeof value !== "number") {
    throw new TypeError(`PRAGMA ${name} returned no number`);
  }
  return value;
}
