import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type {
  UiCacheConnectionPorts,
  UiCacheNativeConnection,
} from "../src/data/uiCacheConnection";
import { requestIncrementalAutoVacuum } from "../src/data/uiCacheVacuum";

export type Executor = { execute(sql: string, params?: readonly unknown[]): Promise<unknown> };

export type Harness = {
  readonly connections: TrackedConnection[];
  readonly databasePath: string;
  readonly ports: UiCacheConnectionPorts;
  readonly removeCacheDirectory: () => void;
};

export type TrackedConnection = UiCacheNativeConnection & {
  closed: boolean;
  /** Holds the next statement matching `sql` until the returned release runs. */
  readonly holdNext: (sql: string) => () => void;
};

/**
 * Real SQLite (node:sqlite) connections stand in for op-sqlite. Both use the
 * unix VFS, so removing the file under an open connection produces the same
 * SQLITE_READONLY_DBMOVED failure Android shows after "Clear cache". Each open
 * applies the production connection setup before any consumer statement.
 */
function openTrackedConnection(path: string): TrackedConnection {
  const native = new DatabaseSync(path);
  requestIncrementalAutoVacuum({ executeSync: (sql) => native.exec(sql) });
  native.exec("PRAGMA foreign_keys = ON");
  const holds = new Map<string, Promise<void>>();
  let tail = Promise.resolve();
  const executor: Executor = {
    async execute(sql, params = []) {
      const hold = holds.get(sql);
      if (hold !== undefined) {
        holds.delete(sql);
        await hold;
      }
      const statement = native.prepare(sql);
      // WHY: tests bind only strings and numbers, which node:sqlite accepts as SQLInputValue.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const values = params as readonly SQLInputValue[];
      // op-sqlite steps every statement to completion; node `run` steps once,
      // which would stop `PRAGMA incremental_vacuum(N)` after one page.
      return statement.columns().length > 0 || sql.startsWith("PRAGMA")
        ? { rows: statement.all(...values) }
        : statement.run(...values);
    },
  };
  const connection: TrackedConnection = {
    ...executor,
    close: () => {
      connection.closed = true;
      native.close();
    },
    closed: false,
    holdNext: (sql) => {
      let release!: () => void;
      holds.set(
        sql,
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      return release;
    },
    async transaction(operation) {
      const next = tail.then(async () => {
        native.exec("BEGIN");
        try {
          await operation(executor);
          native.exec("COMMIT");
        } catch (cause) {
          native.exec("ROLLBACK");
          throw cause;
        }
      });
      tail = next.catch(() => undefined);
      return next;
    },
  };
  return connection;
}

/** Creates connection ports over a real database file under `root`. */
export function createHarness(root: string): Harness {
  const directory = join(root, "cache", "codex-remote", "sqlite");
  const databasePath = join(directory, "codex-remote-ui-cache.db");
  mkdirSync(directory, { recursive: true });
  const connections: TrackedConnection[] = [];
  return {
    connections,
    databasePath,
    ports: {
      databaseFileExists: async () => existsSync(databasePath),
      databasePath,
      open: () => {
        mkdirSync(directory, { recursive: true });
        const connection = openTrackedConnection(databasePath);
        connections.push(connection);
        return connection;
      },
      prepareRestoreTarget: async () => {
        mkdirSync(directory, { recursive: true });
        for (const suffix of ["-journal", "-wal", "-shm"]) {
          rmSync(`${databasePath}${suffix}`, { force: true });
        }
      },
      removeDatabaseFile: async () => {
        rmSync(databasePath, { force: true });
      },
    },
    removeCacheDirectory: () => {
      rmSync(join(root, "cache"), { force: true, recursive: true });
    },
  };
}

/** Reads rows through an independent connection, as a later process would. */
export function readFileRows(path: string, sql: string): unknown[] {
  const reader = new DatabaseSync(path);
  try {
    return reader
      .prepare(sql)
      .all()
      .map((row) => ({ ...row }));
  } finally {
    reader.close();
  }
}

/** Closes every connection the harness opened that is still open. */
export function closeHarness(harness: Harness): void {
  for (const connection of harness.connections) {
    if (!connection.closed) {
      connection.close();
    }
  }
}
