import { open } from "@op-engineering/op-sqlite";
import { wrapSqliteDatabase, type SqliteDatabase, type SqliteDatabaseLike } from "@codewide/tanstack-db-sqlite";
import { cacheDirectory } from "expo-file-system/legacy";
import { AppState } from "react-native";

const LIVE_COLLECTIONS = new Set(["thread-details-v2"]);

let sharedDatabase: ReturnType<typeof open> | null = null;
let sharedSqliteDatabase: SqliteDatabase | null = null;
let lifecycleFlushInstalled = false;
const flushersByCollection = new Map<string, Set<() => Promise<void>>>();

function getUiCacheNativeDatabase(): ReturnType<typeof open> {
  if (sharedDatabase !== null) return sharedDatabase;
  if (cacheDirectory === null) throw new Error("Android cache directory is unavailable");
  sharedDatabase = open({ name: "codex-remote-ui-cache.db", location: `${cacheDirectory}codex-remote/sqlite` });
  return sharedDatabase;
}

export function getUiCacheSqliteDatabase(): SqliteDatabase {
  sharedSqliteDatabase ??= wrapSqliteDatabase(getUiCacheNativeDatabase() as unknown as SqliteDatabaseLike);
  installLifecycleFlush();
  return sharedSqliteDatabase;
}

export function openLegacyUiCacheSqliteDatabase(): { database: SqliteDatabase; close(): void } {
  const nativeDatabase = open({ name: "codex-remote-ui-cache.db", location: "default" });
  return {
    database: wrapSqliteDatabase(nativeDatabase as unknown as SqliteDatabaseLike),
    close: () => nativeDatabase.close(),
  };
}

export function registerUiCacheCollectionFlusher(collectionId: string, flush: () => Promise<void>): () => void {
  const flushers = flushersByCollection.get(collectionId) ?? new Set<() => Promise<void>>();
  flushers.add(flush);
  flushersByCollection.set(collectionId, flushers);
  return () => {
    flushers.delete(flush);
    if (flushers.size === 0) flushersByCollection.delete(collectionId);
  };
}

export async function flushUiCacheCollection(collectionId: string): Promise<void> {
  await Promise.all([...flushersByCollection.get(collectionId) ?? []].map(async (flush) => await flush()));
}

export async function flushLiveUiCacheCheckpoints(): Promise<void> {
  await Promise.all([...LIVE_COLLECTIONS].map(flushUiCacheCollection));
}

function installLifecycleFlush(): void {
  if (lifecycleFlushInstalled) return;
  lifecycleFlushInstalled = true;
  AppState.addEventListener("change", (state) => {
    if (state === "active") return;
    void flushLiveUiCacheCheckpoints().catch((cause: unknown) => {
      console.warn("Could not flush live UI checkpoints before backgrounding", cause);
    });
  });
}
