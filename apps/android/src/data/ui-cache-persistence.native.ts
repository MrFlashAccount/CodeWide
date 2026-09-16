import { open } from "@op-engineering/op-sqlite";
import { wrapSqliteDatabase, type SqliteDatabase } from "@codewide/tanstack-db-sqlite";
import { cacheDirectory, getInfoAsync } from "expo-file-system/legacy";
import { AppState } from "react-native";
import { appLogger } from "../observability/logger";

const LIVE_COLLECTIONS = new Set(["thread-details-v2"]);

let sharedDatabase: ReturnType<typeof open> | null = null;
let sharedSqliteDatabase: SqliteDatabase | null = null;
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

function getUiCacheNativeDatabase(): ReturnType<typeof open> {
  if (sharedDatabase !== null) {
    return sharedDatabase;
  }
  const database = open({ location: uiCacheDirectory(), name: "codex-remote-ui-cache.db" });
  // Configure the connection before any consumer can start a transaction.
  // History memberships must never outlive their chain or referenced content.
  try {
    database.executeSync("PRAGMA foreign_keys = ON");
  } catch (error) {
    database.close();
    throw error;
  }
  sharedDatabase = database;
  return sharedDatabase;
}

export async function getUiCacheFileDiagnostics(): Promise<UiCacheFileDiagnostics> {
  const path = `${uiCacheDirectory()}/codex-remote-ui-cache.db`;
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

export function getUiCacheSqliteDatabase(): SqliteDatabase {
  sharedSqliteDatabase ??= wrapSqliteDatabase(getUiCacheNativeDatabase());
  installLifecycleFlush();
  return sharedSqliteDatabase;
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
    void flushLiveUiCacheCheckpoints().catch((error: unknown) => {
      appLogger.warnCaught({ error: error, event: "ui_cache.background_flush.failed" });
    });
  });
}
