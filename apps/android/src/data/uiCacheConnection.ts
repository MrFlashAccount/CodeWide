import type { SqliteDatabaseLike } from "@codewide/tanstack-db-sqlite";
import { appLogger } from "../observability/logger";

/** One open native UI cache connection that the recovery owner can copy from and close. */
export type UiCacheNativeConnection = SqliteDatabaseLike & {
  readonly close: () => void;
};

/** Platform file and connection capabilities used to restore a removed UI cache database. */
export type UiCacheConnectionPorts = {
  /** Resolves whether the main database file still exists at its configured path. */
  readonly databaseFileExists: () => Promise<boolean>;
  /** Filesystem path of the main database file, without a URI scheme. */
  readonly databasePath: string;
  /** Opens and configures a new connection at the configured path. */
  readonly open: () => UiCacheNativeConnection;
  /** Recreates the database directory and removes journal sidecars left at the configured path. */
  readonly prepareRestoreTarget: () => Promise<void>;
  /** Removes a partially restored main database file. */
  readonly removeDatabaseFile: () => Promise<void>;
};

/** Result of an exclusive operation; `busy` means admitted operations did not settle in time. */
type UiCacheExclusiveOutcome<Value> =
  | { readonly status: "busy" }
  | { readonly status: "ran"; readonly value: Value };

/** The shared UI cache connection plus exclusive access for whole-file maintenance. */
export type RecoverableUiCacheConnection = SqliteDatabaseLike & {
  /**
   * Runs `operation` alone on the current connection after every admitted
   * operation settles; later operations wait until it finishes. Resolves
   * `busy` without running it when admitted operations do not settle within
   * the drain bound. The operation must not retain the connection.
   */
  readonly runExclusive: <Value>(
    operation: (connection: SqliteDatabaseLike) => Promise<Value>,
  ) => Promise<UiCacheExclusiveOutcome<Value>>;
};

type ConnectionSlot = {
  readonly connection: UiCacheNativeConnection;
  readonly drainWaiters: Set<() => void>;
  inFlight: number;
};

type OperationOutcome<Value> =
  | { readonly status: "ok"; readonly value: Value }
  | { readonly error: unknown; readonly status: "error" };

// SQLite reports SQLITE_READONLY_DBMOVED with the generic SQLITE_READONLY text,
// and op-sqlite exposes only that message to JavaScript.
const READONLY_DATABASE_MESSAGE = "attempt to write a readonly database";
const DRAIN_TIMEOUT_MS = 2000;

/**
 * Keeps the shared UI cache connection usable when the OS removes its file.
 *
 * Android may delete the cache directory while the process keeps the database
 * open. SQLite then refuses every write with SQLITE_READONLY_DBMOVED while the
 * open descriptor still reads the removed file. The owner copies the removed
 * database back to its path with `VACUUM INTO`, so schema, triggers and the
 * rows behind every consumer's in-memory mirror stay consistent, then swaps
 * the connection and retries the failed operation once. Consumers keep the
 * returned object and never observe the replacement.
 *
 * Recovery and whole-file maintenance run as exclusive sections: one at a
 * time, after admitted operations drain, while new operations wait.
 */
export function createRecoverableUiCacheConnection(
  ports: UiCacheConnectionPorts,
): RecoverableUiCacheConnection {
  let current = connectionSlot(ports.open());
  let gate: Promise<void> | null = null;
  let recovery: Promise<void> | null = null;

  // Claims the gate synchronously, so operations issued after the request
  // wait for the section even when it still waits for an earlier one.
  const exclusive = async <Value>(section: () => Promise<Value>): Promise<Value> => {
    const previous = gate;
    const running = previous === null ? section() : previous.then(section);
    const release = (): void => {
      if (gate === released) {
        gate = null;
      }
    };
    const released: Promise<void> = running.then(release, release);
    gate = released;
    return running;
  };

  // Admits synchronously while no exclusive section is pending, so an
  // operation issued before a section is counted before that section drains.
  const acquire = async (): Promise<ConnectionSlot> => {
    while (gate !== null) {
      await gate;
    }
    current.inFlight += 1;
    return current;
  };

  const restore = async (stale: ConnectionSlot, cause: unknown): Promise<void> => {
    if (await databaseFileStillExists(ports)) {
      return;
    }
    const drained = await waitForDrain(stale);
    const restored = await restoreDatabaseFile(ports, stale.connection);
    let replacement: UiCacheNativeConnection;
    try {
      replacement = ports.open();
    } catch (error) {
      appLogger.errorCaught({ error: error, event: "ui_cache.reopen_failed" });
      return;
    }
    current = connectionSlot(replacement);
    if (drained) {
      closeQuietly(stale.connection);
    }
    appLogger.warnCaught({
      error: cause,
      event: "ui_cache.database_reopened",
      fields: { drained: drained, restored: restored },
    });
  };

  const recoverFrom = async (lease: ConnectionSlot, error: unknown): Promise<boolean> => {
    if (recovery === null && lease === current && isRemovedDatabaseWriteError(error)) {
      recovery = exclusive(async () => restore(lease, error)).finally(() => {
        recovery = null;
      });
    }
    if (recovery !== null) {
      await recovery;
    }
    // Retry exactly when the connection that served this operation was replaced.
    return lease !== current;
  };

  const run = async <Value>(
    operation: (connection: UiCacheNativeConnection) => Promise<Value>,
  ): Promise<Value> => {
    const lease = await acquire();
    const outcome = await settle(lease, operation);
    if (outcome.status === "ok") {
      return outcome.value;
    }
    if (!(await recoverFrom(lease, outcome.error))) {
      throw outcome.error;
    }
    const retry = await acquire();
    try {
      return await operation(retry.connection);
    } finally {
      release(retry);
    }
  };

  return {
    execute: async (sql, params) => run(async (connection) => connection.execute(sql, params)),
    runExclusive: async (operation) =>
      exclusive(async () => {
        const slot = current;
        if (!(await waitForDrain(slot))) {
          return { status: "busy" };
        }
        return { status: "ran", value: await operation(slot.connection) };
      }),
    transaction: async (operation) => run(async (connection) => connection.transaction(operation)),
  };
}

function connectionSlot(connection: UiCacheNativeConnection): ConnectionSlot {
  return { connection: connection, drainWaiters: new Set(), inFlight: 0 };
}

async function settle<Value>(
  lease: ConnectionSlot,
  operation: (connection: UiCacheNativeConnection) => Promise<Value>,
): Promise<OperationOutcome<Value>> {
  try {
    return { status: "ok", value: await operation(lease.connection) };
  } catch (error) {
    return { error: error, status: "error" };
  } finally {
    release(lease);
  }
}

function release(lease: ConnectionSlot): void {
  lease.inFlight -= 1;
  if (lease.inFlight === 0) {
    for (const drained of lease.drainWaiters) {
      drained();
    }
  }
}

function isRemovedDatabaseWriteError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(READONLY_DATABASE_MESSAGE);
}

async function databaseFileStillExists(ports: UiCacheConnectionPorts): Promise<boolean> {
  try {
    return await ports.databaseFileExists();
  } catch (error) {
    // Without proof that the file was removed, keep the connection and surface the original error.
    appLogger.warnCaught({ error: error, event: "ui_cache.file_check_failed" });
    return true;
  }
}

/** Resolves true when every operation admitted on the slot settled before the timeout. */
async function waitForDrain(slot: ConnectionSlot): Promise<boolean> {
  if (slot.inFlight === 0) {
    return true;
  }
  return new Promise((resolve) => {
    const drained = (): void => {
      clearTimeout(timer);
      slot.drainWaiters.delete(drained);
      resolve(true);
    };
    const timer = setTimeout(() => {
      slot.drainWaiters.delete(drained);
      resolve(false);
    }, DRAIN_TIMEOUT_MS);
    slot.drainWaiters.add(drained);
  });
}

/** Copies the removed database to its path; resolves false when the cache starts empty instead. */
async function restoreDatabaseFile(
  ports: UiCacheConnectionPorts,
  stale: UiCacheNativeConnection,
): Promise<boolean> {
  try {
    await ports.prepareRestoreTarget();
    await stale.execute("VACUUM INTO ?", [ports.databasePath]);
    return true;
  } catch (error) {
    // Consumers prepared their schema on the removed file. An empty replacement
    // keeps writes possible but leaves those tables missing until restart.
    appLogger.errorCaught({ error: error, event: "ui_cache.restore_failed" });
    await ports.removeDatabaseFile().catch((removeError: unknown) => {
      appLogger.warnCaught({ error: removeError, event: "ui_cache.restore_cleanup_failed" });
    });
    return false;
  }
}

function closeQuietly(connection: UiCacheNativeConnection): void {
  try {
    connection.close();
  } catch (error) {
    appLogger.warnCaught({ error: error, event: "ui_cache.stale_close_failed" });
  }
}
