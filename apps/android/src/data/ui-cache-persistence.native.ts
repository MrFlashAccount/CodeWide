import { open } from "@op-engineering/op-sqlite";
import { cacheDirectory } from "expo-file-system/legacy";
import { AppState } from "react-native";
import {
  createReactNativeSQLitePersistence,
  type OpSQLiteDatabaseLike,
  type PersistedCollectionPersistence,
} from "@tanstack/react-native-db-sqlite-persistence";

import { CoalescedPersistenceWriter } from "./coalesced-persistence";
import { DurableCommitTracker, persistDurablyWithRetry } from "./durable-commit-tracker";
import { incrementMetric, recordTiming } from "./operational-metrics";

const LIVE_CHECKPOINT_DELAY_MS = 250;
const COALESCED_COLLECTIONS = new Set([
  "thread-details-v2",
  "thread-detail-invalidations-v1",
]);

let sharedPersistence: PersistedCollectionPersistence | null = null;
let lifecycleFlushInstalled = false;
const durableCommits = new DurableCommitTracker();
const trackedAdapters = new WeakMap<object, PersistedCollectionPersistence["adapter"]>();
const coalescedWriters = new WeakMap<object, CoalescedPersistenceWriter>();
const writersByCollection = new Map<string, Set<CoalescedPersistenceWriter>>();

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
  installLifecycleFlush();
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
  await durableCommits.track(collectionId, commit, { forceFlush: true });
}

/** Commits to the live collection now and resolves after its grouped SQLite
 * checkpoint. Native projection acknowledgement uses this promise without
 * holding up later visual deltas. */
export function commitUiCacheSyncCheckpointed(collectionId: string, commit: () => void): Promise<void> {
  return durableCommits.track(collectionId, commit, { forceFlush: false });
}

export function commitUiCacheMutationCheckpointed<T>(
  collectionId: string,
  mutate: () => T,
  options: { forceFlush?: boolean } = {},
): { value: T; checkpoint: Promise<void> } {
  let value!: T;
  const checkpoint = durableCommits.track(collectionId, () => {
    value = mutate();
  }, { forceFlush: options.forceFlush ?? false });
  return { value, checkpoint };
}

export async function flushUiCacheCollection(collectionId: string): Promise<void> {
  await Promise.all([...writersByCollection.get(collectionId) ?? []].map(async (writer) => {
    await writer.flush(collectionId);
  }));
}

export async function flushLiveUiCacheCheckpoints(): Promise<void> {
  await Promise.all([...COALESCED_COLLECTIONS].map(flushUiCacheCollection));
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
      if (COALESCED_COLLECTIONS.has(collectionId)) {
        const writer = coalescedWriter(adapter);
        const writers = writersByCollection.get(collectionId) ?? new Set<CoalescedPersistenceWriter>();
        writers.add(writer);
        writersByCollection.set(collectionId, writers);
        await writer.enqueue(collectionId, transaction, durableCommits.claim(collectionId));
        return;
      }
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

function coalescedWriter(adapter: PersistedCollectionPersistence["adapter"]): CoalescedPersistenceWriter {
  const cached = coalescedWriters.get(adapter as object);
  if (cached !== undefined) return cached;
  const writer = new CoalescedPersistenceWriter({
    delayMs: LIVE_CHECKPOINT_DELAY_MS,
    persist: async (collectionId, transaction) => {
      const startedAt = performance.now();
      await persistDurablyWithRetry(
        async () => await adapter.applyCommittedTx(collectionId, transaction),
        {
          onRetry(cause, attempt, delayMs) {
            if (attempt !== 1 && attempt % 10 !== 0) return;
            console.warn(`SQLite checkpoint retry for ${collectionId} in ${delayMs} ms:`, cause);
          },
        },
      );
      recordTiming("sqlite_checkpoint_ms", performance.now() - startedAt);
    },
    onCheckpoint(_collectionId, transactionCount) {
      incrementMetric("sqlite_checkpoints");
      if (transactionCount > 1) incrementMetric("sqlite_transactions_coalesced", transactionCount - 1);
    },
    onBackgroundError(cause) {
      console.warn("SQLite background checkpoint failed", cause);
    },
  });
  coalescedWriters.set(adapter as object, writer);
  return writer;
}
