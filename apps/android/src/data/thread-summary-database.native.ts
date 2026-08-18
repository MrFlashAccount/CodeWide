import type { SyncEvent, SyncSnapshotThread } from "@codewide/sync-client";
import { createCollection, type Collection } from "@tanstack/react-db";
import { persistedCollectionOptions } from "@tanstack/react-native-db-sqlite-persistence";

import type { NativeCommandDelivery } from "../native/native-transport";
import type { StoredThreadSummary } from "./thread-summary-types";
import {
  projectThreadSummaryEvent,
  projectThreadSummarySnapshot,
  retainThreadSummaryMissingFromSnapshot,
  threadSummaryKey,
} from "./thread-summary-projection";
import { commitUiCacheSyncDurably, getUiCachePersistence } from "./ui-cache-persistence.native";
import { SerialTaskQueue } from "./serial-task-queue";

const THREAD_SUMMARY_COLLECTION_ID = "thread-summaries-v2";

export type ThreadSummaryDatabase = {
  collection: Collection<StoredThreadSummary, string>;
  applySnapshot(connectionId: string, threads: SyncSnapshotThread[], cursor: number): Promise<void>;
  mergeSnapshots(connectionId: string, threads: SyncSnapshotThread[]): Promise<void>;
  applyEvents(connectionId: string, events: SyncEvent[]): Promise<void>;
  insertStartedThread(connectionId: string, thread: import("@codewide/codex-protocol/v0.147.0/v2").Thread): Promise<void>;
  beginDelete(connectionId: string, threadId: string, commandId: string): Promise<void>;
  rollbackDelete(connectionId: string, threadId: string, commandId: string): Promise<void>;
  applyCommandDelivery(delivery: NativeCommandDelivery): Promise<void>;
  reconcileDeleteCommands(deliveries: readonly NativeCommandDelivery[]): Promise<void>;
  setRenameHandler(handler: ThreadRenameHandler): void;
  search(query: string, connectionId?: string | null): StoredThreadSummary[];
  updatePinned(connectionId: string, threadId: string, pinned: boolean): Promise<void>;
  updateArchived(connectionId: string, threadId: string, archived: boolean): Promise<void>;
  updateName(connectionId: string, threadId: string, name: string): Promise<void>;
  markRead(connectionId: string, threadId: string): Promise<void>;
  close(): void;
};

type ThreadRenameHandler = (connectionId: string, threadId: string, name: string) => Promise<void>;

type SyncControls = {
  begin(options?: { immediate?: boolean }): void;
  write(change:
    | { type: "insert" | "update"; value: StoredThreadSummary }
    | { type: "delete"; key: string }
  ): void;
  commit(): void;
};

export function createThreadSummaryDatabase(): ThreadSummaryDatabase {
  let renameHandler: ThreadRenameHandler | null = null;
  let controls: SyncControls | null = null;
  let source = new Map<string, StoredThreadSummary>();
  let bootstrapped = false;
  let disposed = false;
  const writes = new SerialTaskQueue();

  const collection = createCollection(
    persistedCollectionOptions<StoredThreadSummary, string>({
      id: THREAD_SUMMARY_COLLECTION_ID,
      // The new lifecycle fields are optional and backward compatible. Keep
      // the schema version so an app update does not discard the offline index.
      schemaVersion: 4,
      getKey: (row) => threadSummaryKey(row.connectionId, row.remoteThreadId),
      persistence: getUiCachePersistence(),
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          controls = { begin, write, commit };
          // Persistence is the warm-start source. Native snapshot/deltas replace
          // or update it later through the same ordered Interface.
          markReady();
          return { cleanup: () => { controls = null; } };
        },
      },
      onUpdate: async ({ transaction }) => {
        for (const mutation of transaction.mutations) {
          const before = mutation.original;
          const after = mutation.modified;
          if (before.name !== after.name) {
            if (renameHandler === null || after.name === null) throw new Error("Thread rename transport is not ready");
            await renameHandler(after.connectionId, after.remoteThreadId, after.name);
          }
          await publish(after);
        }
      },
    }),
  );

  const bootstrap = (): void => {
    if (bootstrapped) return;
    source = new Map(collection.toArray.map((row) => [threadSummaryKey(row.connectionId, row.remoteThreadId), row]));
    bootstrapped = true;
  };

  const publish = async (row: StoredThreadSummary): Promise<void> => {
    await writes.run(async () => {
      if (disposed || controls === null) return;
      bootstrap();
      const key = threadSummaryKey(row.connectionId, row.remoteThreadId);
      const previous = source.get(key);
      source.set(key, row);
      controls.begin({ immediate: true });
      controls.write({ type: previous === undefined ? "insert" : "update", value: row });
      await commitUiCacheSyncDurably(THREAD_SUMMARY_COLLECTION_ID, controls.commit);
    });
  };

  const remove = async (key: string): Promise<void> => {
    await writes.run(async () => {
      if (disposed || controls === null) return;
      source.delete(key);
      controls.begin({ immediate: true });
      controls.write({ type: "delete", key });
      await commitUiCacheSyncDurably(THREAD_SUMMARY_COLLECTION_ID, controls.commit);
    });
  };

  const applyDeleteDelivery = async (delivery: NativeCommandDelivery): Promise<void> => {
    if (delivery.method !== "thread/delete" || delivery.threadId === null) return;
    const key = threadSummaryKey(delivery.connectionId, delivery.threadId);
    bootstrap();
    const row = source.get(key);
    if (row === undefined || row.deleteCommandId !== delivery.commandId) return;
    if (delivery.state === "failed") {
      await publish({ ...row, deleteCommandId: null });
    } else if (delivery.state === "delivered") {
      await remove(key);
    }
  };

  return {
    collection,
    async insertStartedThread(connectionId, thread) {
      const mutation = projectThreadSummaryEvent(connectionId, {
        method: "thread/started",
        params: { thread },
      }, (threadId) => {
        bootstrap();
        return source.get(threadSummaryKey(connectionId, threadId));
      });
      if (mutation?.value !== null && mutation?.value !== undefined) await publish(mutation.value);
    },
    async applySnapshot(connectionId, snapshots) {
      await writes.run(async () => {
        if (disposed || controls === null) return;
        bootstrap();
        const next = new Map<string, StoredThreadSummary>();
        for (const snapshot of snapshots) {
          if (snapshot.thread.ephemeral) continue;
          const key = threadSummaryKey(connectionId, snapshot.thread.id);
          const previous = source.get(key);
          next.set(key, projectThreadSummarySnapshot(connectionId, snapshot.thread, snapshot.archived, previous));
        }
        controls.begin({ immediate: true });
        let mutationCount = 0;
        for (const [key, previous] of source) {
          if (previous.connectionId !== connectionId) continue;
          if (!next.has(key)) {
            // thread/start may return an empty shell before there is a rollout
            // for thread/list to enumerate. Keep that shell until the first
            // activity event makes the server snapshot authoritative.
            if (retainThreadSummaryMissingFromSnapshot(previous)) continue;
            source.delete(key);
            controls.write({ type: "delete", key });
            mutationCount += 1;
          }
        }
        for (const [key, row] of next) {
          const previous = source.get(key);
          source.set(key, row);
          if (previous === undefined) {
            controls.write({ type: "insert", value: row });
            mutationCount += 1;
          } else if (!sameThreadSummary(previous, row)) {
            controls.write({ type: "update", value: row });
            mutationCount += 1;
          }
        }
        if (mutationCount === 0) controls.commit();
        else await commitUiCacheSyncDurably(THREAD_SUMMARY_COLLECTION_ID, controls.commit);
      });
    },
    async mergeSnapshots(connectionId, snapshots) {
      await writes.run(async () => {
        if (disposed || controls === null || snapshots.length === 0) return;
        bootstrap();
        const changed = new Map<string, StoredThreadSummary>();
        for (const snapshot of snapshots) {
          if (snapshot.thread.ephemeral) continue;
          const key = threadSummaryKey(connectionId, snapshot.thread.id);
          const previous = source.get(key);
          const row = projectThreadSummarySnapshot(connectionId, snapshot.thread, snapshot.archived, previous);
          if (previous === undefined || !sameThreadSummary(previous, row)) changed.set(key, row);
        }
        if (changed.size === 0) return;
        controls.begin({ immediate: true });
        for (const [key, row] of changed) {
          const previous = source.get(key);
          source.set(key, row);
          controls.write({ type: previous === undefined ? "insert" : "update", value: row });
        }
        await commitUiCacheSyncDurably(THREAD_SUMMARY_COLLECTION_ID, controls.commit);
      });
    },
    async applyEvents(connectionId, events) {
      await writes.run(async () => {
        if (disposed || controls === null || events.length === 0) return;
        bootstrap();
        const changed = new Map<string, StoredThreadSummary | null>();
        for (const event of events) {
          const mutation = projectThreadSummaryEvent(connectionId, event.payload, (threadId) => {
            const key = threadSummaryKey(connectionId, threadId);
            return changed.get(key) ?? source.get(key) ?? undefined;
          }, undefined, event.cursor);
          if (mutation !== null) changed.set(mutation.key, mutation.value);
        }
        if (changed.size === 0) return;
        controls.begin({ immediate: true });
        for (const [key, row] of changed) {
          if (row === null) {
            source.delete(key);
            controls.write({ type: "delete", key });
          } else {
            const previous = source.get(key);
            source.set(key, row);
            controls.write({ type: previous === undefined ? "insert" : "update", value: row });
          }
        }
        await commitUiCacheSyncDurably(THREAD_SUMMARY_COLLECTION_ID, controls.commit);
      });
    },
    async beginDelete(connectionId, threadId, commandId) {
      bootstrap();
      const row = source.get(threadSummaryKey(connectionId, threadId));
      if (row === undefined) return;
      await publish({ ...row, deleteCommandId: commandId });
    },
    async rollbackDelete(connectionId, threadId, commandId) {
      bootstrap();
      const row = source.get(threadSummaryKey(connectionId, threadId));
      if (row === undefined || row.deleteCommandId !== commandId) return;
      await publish({ ...row, deleteCommandId: null });
    },
    async applyCommandDelivery(delivery) {
      await applyDeleteDelivery(delivery);
    },
    async reconcileDeleteCommands(deliveries) {
      bootstrap();
      const byId = new Map(deliveries.map((delivery) => [`${delivery.connectionId}\u0000${delivery.commandId}`, delivery]));
      for (const row of [...source.values()]) {
        if (row.deleteCommandId === null || row.deleteCommandId === undefined) continue;
        const delivery = byId.get(`${row.connectionId}\u0000${row.deleteCommandId}`);
        if (delivery === undefined || delivery.state === "failed") {
          await publish({ ...row, deleteCommandId: null });
        } else if (delivery.state === "delivered") {
          await applyDeleteDelivery(delivery);
        }
      }
    },
    setRenameHandler(handler) {
      renameHandler = handler;
    },
    search(query, connectionId = null) {
      bootstrap();
      const needle = query.trim().toLocaleLowerCase();
      if (needle === "") return [];
      return [...source.values()]
        .filter((row) => row.deleteCommandId == null
          && row.parentThreadId == null
          && (connectionId === null || row.connectionId === connectionId)
          && `${row.name ?? ""}\n${row.preview}`.toLocaleLowerCase().includes(needle))
        .sort(compareThreadSummaryRecency)
        .slice(0, 200);
    },
    async updatePinned(connectionId, threadId, pinned) {
      const key = threadSummaryKey(connectionId, threadId);
      if (!collection.has(key)) return;
      const transaction = collection.update(key, (draft) => { draft.pinned = pinned; });
      await transaction.isPersisted.promise;
    },
    async updateArchived(connectionId, threadId, archived) {
      const key = threadSummaryKey(connectionId, threadId);
      if (!collection.has(key)) return;
      const transaction = collection.update(key, (draft) => { draft.archived = archived; });
      await transaction.isPersisted.promise;
    },
    async updateName(connectionId, threadId, name) {
      const key = threadSummaryKey(connectionId, threadId);
      if (!collection.has(key)) {
        if (renameHandler === null) throw new Error("Thread rename transport is not ready");
        await renameHandler(connectionId, threadId, name);
        return;
      }
      const transaction = collection.update(key, (draft) => { draft.name = name; });
      await transaction.isPersisted.promise;
    },
    async markRead(connectionId, threadId) {
      const key = threadSummaryKey(connectionId, threadId);
      if (!collection.has(key)) return;
      const transaction = collection.update(key, (draft) => {
        draft.lastSeenCursor = draft.latestActivityCursor;
        draft.unread = 0;
      });
      await transaction.isPersisted.promise;
    },
    close() {
      disposed = true;
      collection.cleanup();
    },
  };

}

function sameThreadSummary(left: StoredThreadSummary, right: StoredThreadSummary): boolean {
  return left.connectionId === right.connectionId
    && left.remoteThreadId === right.remoteThreadId
    && left.parentThreadId === right.parentThreadId
    && left.agentNickname === right.agentNickname
    && left.agentRole === right.agentRole
    && left.name === right.name
    && left.preview === right.preview
    && left.cwd === right.cwd
    && (left.gitOriginUrl ?? null) === (right.gitOriginUrl ?? null)
    && left.updatedAt === right.updatedAt
    && left.recencyAt === right.recencyAt
    && left.status.type === right.status.type
    && left.pinned === right.pinned
    && left.archived === right.archived
    && left.pendingRequestCount === right.pendingRequestCount
    && left.latestActivityCursor === right.latestActivityCursor
    && left.lastSeenCursor === right.lastSeenCursor
    && left.unread === right.unread
    && left.provisionalThread === right.provisionalThread
    && left.deleteCommandId === right.deleteCommandId;
}

function compareThreadSummaryRecency(left: StoredThreadSummary, right: StoredThreadSummary): number {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
  return (right.recencyAt ?? right.updatedAt) - (left.recencyAt ?? left.updatedAt);
}
