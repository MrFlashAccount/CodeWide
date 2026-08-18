import { open } from "@op-engineering/op-sqlite";
import { cacheDirectory } from "expo-file-system/legacy";
import {
  createReactNativeSQLitePersistence,
  type OpSQLiteDatabaseLike,
  type PersistedCollectionPersistence,
} from "@tanstack/react-native-db-sqlite-persistence";

import { DurableCommitTracker, persistDurablyWithRetry } from "./durable-commit-tracker";

let sharedPersistence: PersistedCollectionPersistence | null = null;
const durableCommits = new DurableCommitTracker();
const trackedAdapters = new WeakMap<object, PersistedCollectionPersistence["adapter"]>();

export function getUiCachePersistence(): PersistedCollectionPersistence {
  if (sharedPersistence !== null) return sharedPersistence;
  if (cacheDirectory === null) throw new Error("Android cache directory is unavailable");
  const database = open({
    name: "codex-remote-ui-cache.db",
    location: `${cacheDirectory}codex-remote/sqlite`,
  });
  // OP-SQLite 15 uses mutable Scalar[] while the TanStack adapter accepts
  // readonly parameters. Keep the dependency-version compatibility seam here.
  sharedPersistence = trackPersistence(createReactNativeSQLitePersistence({
    database: database as unknown as OpSQLiteDatabaseLike,
  }));
  return sharedPersistence;
}

export function openLegacyUiCachePersistence(): {
  persistence: PersistedCollectionPersistence;
  close(): void;
} {
  const database = open({ name: "codex-remote-ui-cache.db", location: "default" });
  return {
    persistence: createReactNativeSQLitePersistence({
      database: database as unknown as OpSQLiteDatabaseLike,
    }),
    close() {
      database.close();
    },
  };
}

export async function commitUiCacheSyncDurably(collectionId: string, commit: () => void): Promise<void> {
  await durableCommits.track(collectionId, commit);
}

function trackPersistence(persistence: PersistedCollectionPersistence): PersistedCollectionPersistence {
  return {
    ...persistence,
    adapter: trackAdapter(persistence.adapter),
    ...(persistence.resolvePersistenceForCollection === undefined ? {} : {
      resolvePersistenceForCollection: (options) => trackPersistence(persistence.resolvePersistenceForCollection!(options)),
    }),
    ...(persistence.resolvePersistenceForMode === undefined ? {} : {
      resolvePersistenceForMode: (mode) => trackPersistence(persistence.resolvePersistenceForMode!(mode)),
    }),
  };
}

function trackAdapter(adapter: PersistedCollectionPersistence["adapter"]): PersistedCollectionPersistence["adapter"] {
  const cached = trackedAdapters.get(adapter as object);
  if (cached !== undefined) return cached;
  const tracked: PersistedCollectionPersistence["adapter"] = {
    loadSubset: adapter.loadSubset.bind(adapter),
    applyCommittedTx: async (collectionId, transaction) => {
      await durableCommits.observe(collectionId, async () => {
        await persistDurablyWithRetry(
          async () => await adapter.applyCommittedTx(collectionId, transaction),
          {
            onRetry(cause, attempt, delayMs) {
              if (attempt !== 1 && attempt % 10 !== 0) return;
              console.warn(`SQLite commit retry for ${collectionId} in ${delayMs} ms:`, cause);
            },
          },
        );
      });
    },
    ensureIndex: adapter.ensureIndex.bind(adapter),
    ...(adapter.loadCollectionMetadata === undefined ? {} : {
      loadCollectionMetadata: adapter.loadCollectionMetadata.bind(adapter),
    }),
    ...(adapter.scanRows === undefined ? {} : { scanRows: adapter.scanRows.bind(adapter) }),
    ...(adapter.markIndexRemoved === undefined ? {} : { markIndexRemoved: adapter.markIndexRemoved.bind(adapter) }),
    ...(adapter.getStreamPosition === undefined ? {} : { getStreamPosition: adapter.getStreamPosition.bind(adapter) }),
  };
  trackedAdapters.set(adapter as object, tracked);
  return tracked;
}
