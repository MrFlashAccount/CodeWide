import { open } from "@op-engineering/op-sqlite";
import { wrapSqliteDatabase, type SqliteDatabase } from "@codewide/tanstack-db-sqlite";
import {
  cacheDirectory,
  deleteAsync,
  getInfoAsync,
  makeDirectoryAsync,
} from "expo-file-system/legacy";
import { AppState } from "react-native";
import { appLogger } from "../observability/logger";
import {
  createRecoverableUiCacheConnection,
  type UiCacheConnectionPorts,
  type UiCacheNativeConnection,
} from "./uiCacheConnection";
import {
  createUiCacheVacuum,
  requestIncrementalAutoVacuum,
  type UiCacheVacuum,
} from "./uiCacheVacuum";

const LIVE_COLLECTIONS = new Set(["thread-details-v2"]);
const UI_CACHE_DATABASE_NAME = "codex-remote-ui-cache.db";
const JOURNAL_SIDECAR_SUFFIXES = ["-journal", "-wal", "-shm"] as const;
const FILE_URI_SCHEME = "file://";

let sharedUiCache: { readonly database: SqliteDatabase; readonly vacuum: UiCacheVacuum } | null =
  null;
let lifecycleFlushInstalled = false;
const flushersByCollection = new Map<string, Set<() => Promise<void>>>();

export type UiCacheFileDiagnostics = {
  mainFileBytes: number;
  shmFileBytes: number;
  walFileBytes: number;
};

function uiCacheDirectory(): string {
  if (cacheDirectory === null) {
    throw new Error("Android cache directory is unavailable");
  }
  return `${cacheDirectory}codex-remote/sqlite`;
}

function uiCacheDatabaseUri(): string {
  return `${uiCacheDirectory()}/${UI_CACHE_DATABASE_NAME}`;
}

function openUiCacheConnection(): UiCacheNativeConnection {
  const database = open({ location: uiCacheDirectory(), name: UI_CACHE_DATABASE_NAME });
  // Configure the connection before any consumer can start a transaction or
  // create a table. History memberships must never outlive their chain or
  // referenced content.
  try {
    requestIncrementalAutoVacuum(database);
    database.executeSync("PRAGMA foreign_keys = ON");
  } catch (error) {
    database.close();
    throw error;
  }
  return database;
}

// The database lives in the disposable cache directory, so Android may delete
// it under the open connection; these ports let the connection owner restore it.
function uiCacheConnectionPorts(): UiCacheConnectionPorts {
  const databaseUri = uiCacheDatabaseUri();
  return {
    databaseFileExists: async () => (await getInfoAsync(databaseUri)).exists,
    // op-sqlite resolves `file://` locations the same way before opening them.
    databasePath: databaseUri.startsWith(FILE_URI_SCHEME)
      ? databaseUri.slice(FILE_URI_SCHEME.length)
      : databaseUri,
    open: openUiCacheConnection,
    prepareRestoreTarget: async () => {
      await makeDirectoryAsync(uiCacheDirectory(), { intermediates: true });
      await Promise.all(
        JOURNAL_SIDECAR_SUFFIXES.map(async (suffix) =>
          deleteAsync(`${databaseUri}${suffix}`, { idempotent: true }),
        ),
      );
    },
    removeDatabaseFile: async () => deleteAsync(databaseUri, { idempotent: true }),
  };
}

export async function getUiCacheFileDiagnostics(): Promise<UiCacheFileDiagnostics> {
  const path = uiCacheDatabaseUri();
  const [mainFileBytes, walFileBytes, shmFileBytes] = await Promise.all([
    fileSize(path),
    fileSize(`${path}-wal`),
    fileSize(`${path}-shm`),
  ]);
  return { mainFileBytes, shmFileBytes, walFileBytes };
}

async function fileSize(path: string): Promise<number> {
  try {
    const info = await getInfoAsync(path);
    return info.exists && typeof info.size === "number" ? info.size : 0;
  } catch {
    // Diagnostics are best effort and must never block opening the cache.
    return 0;
  }
}

function getSharedUiCache(): { readonly database: SqliteDatabase; readonly vacuum: UiCacheVacuum } {
  if (sharedUiCache === null) {
    const connection = createRecoverableUiCacheConnection(uiCacheConnectionPorts());
    sharedUiCache = {
      database: wrapSqliteDatabase(connection),
      vacuum: createUiCacheVacuum(connection),
    };
  }
  installLifecycleFlush();
  return sharedUiCache;
}

export function getUiCacheSqliteDatabase(): SqliteDatabase {
  return getSharedUiCache().database;
}

/**
 * Starts returning pages freed by cache eviction to the filesystem in bounded
 * steps. Call after an eviction commits; never from a per-write path.
 */
export function scheduleUiCacheFreePageReclaim(): void {
  void getSharedUiCache()
    .vacuum.reclaimFreePages()
    .catch((error: unknown) => {
      appLogger.warnCaught({ error: error, event: "ui_cache.free_page_reclaim_failed" });
    });
}

export function openLegacyUiCacheSqliteDatabase(): { close: () => void; database: SqliteDatabase } {
  const nativeDatabase = open({ location: "default", name: "codex-remote-ui-cache.db" });
  return {
    close: () => {
      nativeDatabase.close();
    },
    database: wrapSqliteDatabase(nativeDatabase),
  };
}

export function registerUiCacheCollectionFlusher(
  collectionId: string,
  flush: () => Promise<void>,
): () => void {
  const flushers = flushersByCollection.get(collectionId) ?? new Set<() => Promise<void>>();
  flushers.add(flush);
  flushersByCollection.set(collectionId, flushers);
  return () => {
    flushers.delete(flush);
    if (flushers.size === 0) {
      flushersByCollection.delete(collectionId);
    }
  };
}

export async function flushUiCacheCollection(collectionId: string): Promise<void> {
  await Promise.all(
    [...(flushersByCollection.get(collectionId) ?? [])].map(async (flush) => {
      await flush();
    }),
  );
}

export async function flushLiveUiCacheCheckpoints(): Promise<void> {
  await Promise.all([...LIVE_COLLECTIONS].map(flushUiCacheCollection));
}

function installLifecycleFlush(): void {
  if (lifecycleFlushInstalled) {
    return;
  }
  lifecycleFlushInstalled = true;
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      return;
    }
    const flushed = flushLiveUiCacheCheckpoints().catch((error: unknown) => {
      appLogger.warnCaught({ error: error, event: "ui_cache.background_flush.failed" });
    });
    if (state === "background") {
      // Nothing waits on the cache while the app is hidden, so a database
      // created before auto-vacuum pays its one full VACUUM here, not at open.
      // It follows the flush so durable checkpoints never queue behind it.
      void flushed
        .then(async () => sharedUiCache?.vacuum.migrateAtIdle())
        .catch((error: unknown) => {
          appLogger.warnCaught({ error: error, event: "ui_cache.auto_vacuum_migration_failed" });
        });
    }
  });
}
