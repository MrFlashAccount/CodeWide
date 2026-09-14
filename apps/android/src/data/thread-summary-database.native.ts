import type { ThreadRenameHandler } from "./thread-summary-database-contract";
import type { ThreadSummaryDatabase } from "./thread-summary-database-contract";
export type { ThreadSummaryDatabase } from "./thread-summary-database-contract";
import { threadIdFromEvent, type SyncSnapshotThread } from "@codewide/sync-client";

import type { NativeCommandDelivery } from "../native/native-transport";
import { normalizeStoredThreadSummary, type StoredThreadSummary } from "./thread-summary-types";
import {
  projectThreadSummaryEvent,
  projectThreadSummarySnapshot,
  retainThreadSummaryMissingFromSnapshot,
  threadSummaryDescendantKeys,
  threadSummaryKey,
} from "./thread-summary-projection";
import { SerialTaskQueue } from "./serial-task-queue";
import { createThreadSummaryModel, type ThreadSummaryViewRequest } from "./thread-summary-model";
import { createThreadSummarySqlite } from "./thread-summary-sqlite.native";
import { ThreadCatalogReads } from "./thread-catalog-read";
import { THREAD_CATALOG_PAGE_SIZE } from "./thread-catalog-loader";
import { ProjectUnreadModel } from "./project-unread-model";

export function createThreadSummaryDatabase(): ThreadSummaryDatabase {
  const catalogReads = new ThreadCatalogReads();
  let catalogLoader: ((request: ThreadSummaryViewRequest) => Promise<void>) | null = null;
  let renameHandler: ThreadRenameHandler | null = null;
  let disposed = false;
  const writes = new SerialTaskQueue();
  const model = createThreadSummaryModel();
  const storage = createThreadSummarySqlite();
  const projectUnread = new ProjectUnreadModel();
  let refreshScheduled = false;

  const loadConnectionRows = storage.loadConnectionRows;
  const loadRows = storage.loadRows;
  const loadRow = async (connectionId: string, threadId: string): Promise<StoredThreadSummary | undefined> => (
    await storage.loadRow(connectionId, threadId) ?? undefined
  );

  const loadView = async (request: ThreadSummaryViewRequest): Promise<void> => {
    const generation = model.startView(request);
    try {
      model.commitView(request, generation, await storage.loadView(request));
    } catch (cause) {
      model.failView(request, generation, cause);
      throw cause;
    }
  };

  const scheduleActiveViewRefresh = (): void => {
    if (refreshScheduled || disposed) return;
    refreshScheduled = true;
    queueMicrotask(() => {
      refreshScheduled = false;
      for (const request of model.activeRequests()) void loadView(request).catch(() => undefined);
    });
  };

  const publishModelChanges = (
    changes: readonly ({ type: "insert" | "update"; value: StoredThreadSummary } | { type: "delete"; key: string })[],
    refillBoundedViews = false,
  ): void => {
    for (const change of changes) {
      if (change.type === "delete") {
        const separator = change.key.indexOf("\u0000");
        catalogReads.changed(change.key.slice(0, separator), change.key.slice(separator + 1));
      } else catalogReads.changed(change.value.connectionId, change.value.remoteThreadId);
    }
    model.publish(changes);
    projectUnread.publish(changes);
    if (refillBoundedViews) scheduleActiveViewRefresh();
  };

  const publish = async (row: StoredThreadSummary): Promise<void> => {
    await writes.run(async () => {
      if (disposed) return;
      const normalized = normalizeStoredThreadSummary(row);
      const previous = await loadRow(normalized.connectionId, normalized.remoteThreadId);
      storage.begin();
      storage.write({ type: previous === undefined ? "insert" : "update", value: normalized });
      const checkpoint = storage.commit({ durable: true });
      publishModelChanges(
        [{ type: previous === undefined ? "insert" : "update", value: normalized }],
        previous !== undefined && summaryViewMembershipChanged(previous, normalized),
      );
      await checkpoint;
    });
  };

  const remove = async (key: string): Promise<void> => {
    await writes.run(async () => {
      if (disposed) return;
      storage.begin();
      storage.write({ type: "delete", key });
      const checkpoint = storage.commit({ durable: true });
      publishModelChanges([{ type: "delete", key }], true);
      await checkpoint;
    });
  };

  const applyDeleteDelivery = async (delivery: NativeCommandDelivery): Promise<void> => {
    if (delivery.method !== "thread/delete" || delivery.threadId === null) return;
    const key = threadSummaryKey(delivery.connectionId, delivery.threadId);
    const row = await loadRow(delivery.connectionId, delivery.threadId);
    if (row === undefined || row.deleteCommandId !== delivery.commandId) return;
    if (delivery.state === "failed") {
      await publish({ ...row, deleteCommandId: null });
    } else if (delivery.state === "delivered") {
      await remove(key);
    }
  };

  const replaceSnapshotRows = async (
    connectionId: string,
    snapshots: SyncSnapshotThread[],
    missingScope: (current: readonly StoredThreadSummary[]) => ReadonlySet<string>,
  ): Promise<void> => {
    await writes.run(async () => {
      if (disposed) return;
      const currentRows = await loadConnectionRows(connectionId);
      const current = new Map(currentRows.map((row) => [threadSummaryKey(row.connectionId, row.remoteThreadId), row]));
      const next = new Map<string, StoredThreadSummary>();
      for (const snapshot of snapshots) {
        if (snapshot.thread.ephemeral) continue;
        const key = threadSummaryKey(connectionId, snapshot.thread.id);
        next.set(key, projectThreadSummarySnapshot(connectionId, snapshot.thread, snapshot.archived, current.get(key)));
      }
      const removableKeys = missingScope(currentRows);
      const removed = [...current].filter(([key]) => !next.has(key) && removableKeys.has(key));
      const changed = [...next].filter(([key, row]) => {
        const previous = current.get(key);
        return previous === undefined || !sameThreadSummary(previous, row);
      });
      if (removed.length === 0 && changed.length === 0) return;
      storage.begin();
      for (const [key] of removed) storage.write({ type: "delete", key });
      for (const [key, row] of changed) storage.write({ type: current.has(key) ? "update" : "insert", value: row });
      const checkpoint = storage.commit({ durable: true });
      publishModelChanges([
        ...removed.map(([key]) => ({ type: "delete" as const, key })),
        ...changed.map(([key, row]) => ({ type: current.has(key) ? "update" as const : "insert" as const, value: row })),
      ], removed.length > 0 || changed.some(([key, row]) => {
        const previous = current.get(key);
        return previous !== undefined && summaryViewMembershipChanged(previous, row);
      }));
      await checkpoint;
    });
  };

  return {
    model,
    projectUnread,
    async prepare() {
      await storage.prepare();
      await projectUnread.resource(storage.loadUnread);
    },
    viewResource(request) {
      return model.resource(request, async () => {
        const cached = await storage.loadView(request);
        if (catalogLoader !== null && (request.recentLimit > 0 || request.archivedLimit > 0)) {
          const updating = catalogLoader(request);
          const count = request.archivedLimit > 0 ? cached.archived.length : cached.recent.length;
          if (count === 0) {
            await updating;
            return await storage.loadView(request);
          }
          void updating.catch((cause: unknown) => console.warn("Catalog window refresh failed", cause));
        }
        return cached;
      });
    },
    setCatalogLoader(loader) { catalogLoader = loader; },
    beginCatalogRead: (connectionId) => catalogReads.begin(connectionId),
    async applyCatalogPage(connectionId, snapshots, archived, prefixIds, read, replaceHead, projectCwd) {
      await writes.run(async () => {
        if (disposed) return;
        const count = Math.max(THREAD_CATALOG_PAGE_SIZE, prefixIds.size);
        const window = await storage.loadView({ connectionId, ...(projectCwd === undefined ? {} : { projectCwd }), recentLimit: archived ? 0 : count,
          archivedLimit: archived ? count : 0, selectedConnectionId: null, selectedThreadId: null,
          subagentConnectionId: null, subagentLimit: 0 });
        const existing = await loadRows(connectionId, snapshots.map(({ thread }) => thread.id));
        const current = new Map(existing.map((row) => [row.remoteThreadId, row]));
        const changes: import("./thread-summary-sqlite.native").ThreadSummaryChange[] = [];
        for (const row of replaceHead ? archived ? window.archived : window.recent : []) {
          // Paging a catalog must not erase device-owned unread state outside its head.
          if (!prefixIds.has(row.remoteThreadId) && !row.pinned && row.unread === 0 && row.deleteCommandId === null && !read.changed.has(row.remoteThreadId)) {
            // Evict only this stale cached prefix; absence is not a server
            // thread deletion, and older cached ranges are left untouched.
            changes.push({ type: "delete", key: threadSummaryKey(connectionId, row.remoteThreadId) });
          }
        }
        for (const snapshot of snapshots) {
          if (read.changed.has(snapshot.thread.id)) continue;
          const previous = current.get(snapshot.thread.id);
          const row = projectThreadSummarySnapshot(connectionId, snapshot.thread, archived, previous);
          if (previous === undefined || !sameThreadSummary(previous, row)) {
            changes.push({ type: previous === undefined ? "insert" : "update", value: row });
          }
        }
        if (changes.length === 0) return;
        storage.begin();
        for (const change of changes) storage.write(change);
        const checkpoint = storage.commit({ durable: true });
        publishModelChanges(changes, true);
        await checkpoint;
      });
    },
    loadView,
    async get(connectionId, threadId) {
      return await loadRow(connectionId, threadId) ?? null;
    },
    async insertStartedThread(connectionId, thread) {
      const previous = await loadRow(connectionId, thread.id);
      const mutation = projectThreadSummaryEvent(connectionId, {
        method: "thread/started",
        params: { thread },
        codewideThreadPatch: {
          version: 1,
          threadId: thread.id,
          operation: { kind: "threadStarted", thread },
        },
      }, () => previous);
      if (mutation?.value !== null && mutation?.value !== undefined) await publish(mutation.value);
    },
    async applySnapshot(connectionId, snapshots) {
      await replaceSnapshotRows(connectionId, snapshots, (current) => new Set(current
        .filter((row) => !retainThreadSummaryMissingFromSnapshot(row))
        .map((row) => threadSummaryKey(row.connectionId, row.remoteThreadId))));
    },
    async replaceCatalog(connectionId, snapshots) {
      await replaceSnapshotRows(connectionId, snapshots, (current) => new Set(current
        .filter((row) => !retainThreadSummaryMissingFromSnapshot(row))
        .map((row) => threadSummaryKey(row.connectionId, row.remoteThreadId))));
    },
    async replaceSubagentCatalog(connectionId, rootThreadId, snapshots) {
      const projected = snapshots.filter(({ thread }) => thread.parentThreadId !== null);
      await replaceSnapshotRows(connectionId, projected, (current) => threadSummaryDescendantKeys(current, rootThreadId));
    },
    async mergeSnapshots(connectionId, snapshots) {
      await writes.run(async () => {
        if (disposed || snapshots.length === 0) return;
        const existing = await loadRows(connectionId, snapshots.map(({ thread }) => thread.id));
        const current = new Map(existing.map((row) => [threadSummaryKey(row.connectionId, row.remoteThreadId), row]));
        const changed = new Map<string, StoredThreadSummary>();
        for (const snapshot of snapshots) {
          if (snapshot.thread.ephemeral) continue;
          const key = threadSummaryKey(connectionId, snapshot.thread.id);
          const previous = current.get(key);
          const row = projectThreadSummarySnapshot(connectionId, snapshot.thread, snapshot.archived, previous);
          if (previous === undefined || !sameThreadSummary(previous, row)) changed.set(key, row);
        }
        if (changed.size === 0) return;
        storage.begin();
        for (const [key, row] of changed) {
          const previous = current.get(key);
          storage.write({ type: previous === undefined ? "insert" : "update", value: row });
        }
        const checkpoint = storage.commit({ durable: true });
        publishModelChanges([...changed].map(([key, row]) => ({
          ...(current.has(key) ? { type: "update" as const } : { type: "insert" as const }),
          value: row,
        })), [...changed].some(([key, row]) => {
          const previous = current.get(key);
          return previous !== undefined && summaryViewMembershipChanged(previous, row);
        }));
        await checkpoint;
      });
    },
    async applyEvents(connectionId, events) {
      await writes.run(async () => {
        if (disposed || events.length === 0) return;
        const threadIds = [...new Set(events.flatMap((event) => {
          const threadId = threadIdFromEvent(event.payload);
          return threadId === null ? [] : [threadId];
        }))];
        const existing = await loadRows(connectionId, threadIds);
        const current = new Map(existing.map((row) => [threadSummaryKey(row.connectionId, row.remoteThreadId), row]));
        const changed = new Map<string, StoredThreadSummary | null>();
        for (const event of events) {
          const mutation = projectThreadSummaryEvent(connectionId, event.payload, (threadId) => {
            const key = threadSummaryKey(connectionId, threadId);
            return changed.get(key) ?? current.get(key) ?? undefined;
          }, undefined, event.cursor);
          if (mutation !== null) changed.set(mutation.key, mutation.value);
        }
        if (changed.size === 0) return;
        storage.begin();
        for (const [key, row] of changed) {
          if (row === null) {
            storage.write({ type: "delete", key });
          } else {
            const previous = current.get(key);
            storage.write({ type: previous === undefined ? "insert" : "update", value: row });
          }
        }
        const checkpoint = storage.commit({ durable: true });
        publishModelChanges([...changed].map(([key, row]) => row === null
          ? { type: "delete" as const, key }
          : { type: current.has(key) ? "update" as const : "insert" as const, value: row }), [...changed].some(([key, row]) => {
            if (row === null) return true;
            const previous = current.get(key);
            return previous !== undefined && summaryViewMembershipChanged(previous, row);
          }));
        await checkpoint;
      });
    },
    async beginDelete(connectionId, threadId, commandId) {
      const row = await loadRow(connectionId, threadId);
      if (row === undefined) return;
      await publish({ ...row, deleteCommandId: commandId });
    },
    async rollbackDelete(connectionId, threadId, commandId) {
      const row = await loadRow(connectionId, threadId);
      if (row === undefined || row.deleteCommandId !== commandId) return;
      await publish({ ...row, deleteCommandId: null });
    },
    async applyCommandDelivery(delivery) {
      await applyDeleteDelivery(delivery);
    },
    async reconcileDeleteCommands(deliveries) {
      const byId = new Map(deliveries.map((delivery) => [`${delivery.connectionId}\u0000${delivery.commandId}`, delivery]));
      for (const row of await storage.loadAll()) {
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
    async search(query, connectionId = null) {
      const needle = query.trim().toLocaleLowerCase();
      if (needle === "") return [];
      const rows = connectionId === null ? await storage.loadAll() : await loadConnectionRows(connectionId);
      return rows
        .filter((row) => row.deleteCommandId == null
          && row.parentThreadId == null
          && (connectionId === null || row.connectionId === connectionId)
          && `${row.name ?? ""}\n${row.preview}`.toLocaleLowerCase().includes(needle))
        .sort(compareThreadSummaryRecency)
        .slice(0, 200);
    },
    async updatePinned(connectionId, threadId, pinned) {
      const row = await loadRow(connectionId, threadId);
      if (row !== undefined) await publish({ ...row, pinned });
    },
    async updateArchived(connectionId, threadId, archived) {
      const row = await loadRow(connectionId, threadId);
      if (row !== undefined) await publish({ ...row, archived });
    },
    async updateName(connectionId, threadId, name) {
      if (renameHandler === null) throw new Error("Thread rename transport is not ready");
      await renameHandler(connectionId, threadId, name);
      const row = await loadRow(connectionId, threadId);
      if (row !== undefined) await publish({ ...row, name });
    },
    async markRead(connectionId, threadId) {
      const row = await loadRow(connectionId, threadId);
      if (row !== undefined) await publish({ ...row, lastSeenCursor: row.latestActivityCursor, unread: 0 });
    },
    close() {
      disposed = true;
      model.close();
      projectUnread.close();
      void storage.close().catch((cause: unknown) => console.warn("Could not close thread summary model", cause));
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

function summaryViewMembershipChanged(left: StoredThreadSummary, right: StoredThreadSummary): boolean {
  return left.connectionId !== right.connectionId
    || left.cwd !== right.cwd
    || left.parentThreadId !== right.parentThreadId
    || left.pinned !== right.pinned
    || left.archived !== right.archived
    || left.deleteCommandId !== right.deleteCommandId;
}
