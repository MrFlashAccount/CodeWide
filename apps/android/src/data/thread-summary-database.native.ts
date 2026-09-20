import { appLogger } from "../observability/logger";
import type {
  ThreadRenameHandler,
  ThreadSummaryDatabase,
} from "./thread-summary-database-contract";

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
import {
  createThreadSummaryModel,
  type LoadedThreadSummaryView,
  type ThreadSummaryViewRequest,
} from "./thread-summary-model";
import { createThreadSummarySqlite } from "./thread-summary-sqlite.native";
import { ThreadCatalogReads } from "./thread-catalog-read";
import { THREAD_CATALOG_PAGE_SIZE } from "./thread-catalog-loader";
import { ProjectUnreadModel } from "./project-unread-model";
import type { GlobalSupervisorVisibilityPolicy } from "./globalSupervisorVisibility";
import type {
  GlobalSupervisorSummaryStorageDecision,
  GlobalSupervisorSummaryStoragePolicy,
} from "./globalSupervisorSummaryStoragePolicy";
import { unknownRecord } from "./unknownRecord";

export function createThreadSummaryDatabase(
  options: {
    readonly globalSupervisorStorage?: GlobalSupervisorSummaryStoragePolicy;
    readonly visibility?: GlobalSupervisorVisibilityPolicy;
  } = {},
): ThreadSummaryDatabase {
  const catalogReads = new ThreadCatalogReads();
  let catalogLoader: ((request: ThreadSummaryViewRequest) => Promise<void>) | null = null;
  let renameHandler: ThreadRenameHandler | null = null;
  let disposed = false;
  const writes = new SerialTaskQueue();
  const model = createThreadSummaryModel();
  const storage = createThreadSummarySqlite();
  const projectUnread = new ProjectUnreadModel();
  let refreshScheduled = false;

  const storageDecisionForRef = (
    connectionId: string,
    threadId: string,
  ): GlobalSupervisorSummaryStorageDecision =>
    options.globalSupervisorStorage?.classifyRef(connectionId, threadId) ?? "write";
  const storageDecisionForThread = (
    connectionId: string,
    thread: { readonly id: string; readonly source?: string | null },
  ): GlobalSupervisorSummaryStorageDecision =>
    options.globalSupervisorStorage?.classifyThread(connectionId, thread) ?? "write";

  const isHidden = (row: StoredThreadSummary): boolean =>
    options.visibility?.allowsOrdinaryRef(row.connectionId, row.remoteThreadId) === false;
  const visibleRows = (rows: StoredThreadSummary[]): StoredThreadSummary[] =>
    rows.filter((row) => !isHidden(row));
  const loadConnectionRows = async (connectionId: string): Promise<StoredThreadSummary[]> =>
    visibleRows(await storage.loadConnectionRows(connectionId));
  const loadRows = async (
    connectionId: string,
    threadIds: readonly string[],
  ): Promise<StoredThreadSummary[]> => visibleRows(await storage.loadRows(connectionId, threadIds));
  const loadRow = async (
    connectionId: string,
    threadId: string,
  ): Promise<StoredThreadSummary | undefined> =>
    options.visibility?.allowsOrdinaryRef(connectionId, threadId) === false
      ? undefined
      : ((await storage.loadRow(connectionId, threadId)) ?? undefined);

  const filterView = (view: LoadedThreadSummaryView): LoadedThreadSummaryView => ({
    archived: view.archived.filter((row) => !isHidden(row)),
    pinned: view.pinned.filter((row) => !isHidden(row)),
    recent: view.recent.filter((row) => !isHidden(row)),
    selected: view.selected.filter((row) => !isHidden(row)),
    subagents: view.subagents.filter((row) => !isHidden(row)),
  });

  const loadView = async (request: ThreadSummaryViewRequest): Promise<void> => {
    const generation = model.startView(request);
    try {
      model.commitView(request, generation, filterView(await storage.loadView(request)));
    } catch (error) {
      model.failView(request, generation, error);
      throw error;
    }
  };

  const scheduleActiveViewRefresh = (): void => {
    if (refreshScheduled || disposed) {
      return;
    }
    refreshScheduled = true;
    queueMicrotask(() => {
      refreshScheduled = false;
      for (const request of model.activeRequests()) {
        void loadView(request).catch(() => undefined);
      }
    });
  };

  const publishModelChanges = (
    changes: readonly (
      | { type: "insert" | "update"; value: StoredThreadSummary }
      | { key: string; type: "delete" }
    )[],
    refillBoundedViews = false,
  ): void => {
    for (const change of changes) {
      if (change.type === "delete") {
        const separator = change.key.indexOf("\u0000");
        catalogReads.changed(change.key.slice(0, separator), change.key.slice(separator + 1));
      } else {
        catalogReads.changed(change.value.connectionId, change.value.remoteThreadId);
      }
    }
    model.publish(changes);
    projectUnread.publish(changes);
    if (refillBoundedViews) {
      scheduleActiveViewRefresh();
    }
  };

  const publish = async (row: StoredThreadSummary): Promise<void> => {
    await writes.run(async () => {
      if (disposed) {
        return;
      }
      const normalized = normalizeStoredThreadSummary(row);
      const storageDecision = storageDecisionForRef(
        normalized.connectionId,
        normalized.remoteThreadId,
      );
      if (storageDecision === "preserve") {
        return;
      }
      if (storageDecision === "delete") {
        const key = threadSummaryKey(normalized.connectionId, normalized.remoteThreadId);
        const previous = await storage.loadRow(normalized.connectionId, normalized.remoteThreadId);
        if (previous !== null) {
          storage.begin();
          storage.write({ key, type: "delete" });
          const checkpoint = storage.commit({ durable: true });
          publishModelChanges([{ key, type: "delete" }], true);
          await checkpoint;
        }
        return;
      }
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
      if (disposed) {
        return;
      }
      storage.begin();
      storage.write({ key, type: "delete" });
      const checkpoint = storage.commit({ durable: true });
      publishModelChanges([{ key, type: "delete" }], true);
      await checkpoint;
    });
  };

  const applyDeleteDelivery = async (delivery: NativeCommandDelivery): Promise<void> => {
    if (delivery.method !== "thread/delete" || delivery.threadId === null) {
      return;
    }
    const key = threadSummaryKey(delivery.connectionId, delivery.threadId);
    const row = await loadRow(delivery.connectionId, delivery.threadId);
    if (row === undefined || row.deleteCommandId !== delivery.commandId) {
      return;
    }
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
      if (disposed) {
        return;
      }
      const currentRows = await storage.loadConnectionRows(connectionId);
      const current = new Map(
        currentRows.map((row) => [threadSummaryKey(row.connectionId, row.remoteThreadId), row]),
      );
      const next = new Map<string, StoredThreadSummary>();
      const exactHiddenKeys = new Set<string>();
      for (const snapshot of snapshots) {
        if (snapshot.thread.ephemeral) {
          continue;
        }
        const key = threadSummaryKey(connectionId, snapshot.thread.id);
        const storageDecision = storageDecisionForThread(connectionId, {
          id: snapshot.thread.id,
          source: snapshot.thread.threadSource,
        });
        if (storageDecision === "delete") {
          exactHiddenKeys.add(key);
          continue;
        }
        if (storageDecision === "preserve") {
          const previous = current.get(key);
          if (previous !== undefined) {
            next.set(key, previous);
          }
          continue;
        }
        next.set(
          key,
          projectThreadSummarySnapshot(
            connectionId,
            snapshot.thread,
            snapshot.archived,
            current.get(key),
          ),
        );
      }
      const removableKeys =
        options.globalSupervisorStorage?.mayPruneMissing(connectionId) === false
          ? exactHiddenKeys
          : new Set([...missingScope(currentRows), ...exactHiddenKeys]);
      const removed = [...current].filter(([key]) => !next.has(key) && removableKeys.has(key));
      const changed = [...next].filter(([key, row]) => {
        const previous = current.get(key);
        return previous === undefined || !sameThreadSummary(previous, row);
      });
      if (removed.length === 0 && changed.length === 0) {
        return;
      }
      storage.begin();
      for (const [key] of removed) {
        storage.write({ key, type: "delete" });
      }
      for (const [key, row] of changed) {
        storage.write({ type: current.has(key) ? "update" : "insert", value: row });
      }
      const checkpoint = storage.commit({ durable: true });
      publishModelChanges(
        [
          ...removed.map(([key]) => ({ key, type: "delete" as const })),
          ...changed.map(([key, row]) => ({
            type: current.has(key) ? ("update" as const) : ("insert" as const),
            value: row,
          })),
        ],
        removed.length > 0 ||
          changed.some(([key, row]) => {
            const previous = current.get(key);
            return previous !== undefined && summaryViewMembershipChanged(previous, row);
          }),
      );
      await checkpoint;
    });
  };

  return {
    async applyCatalogPage(
      connectionId,
      snapshots,
      archived,
      prefixIds,
      read,
      replaceHead,
      projectCwd,
    ) {
      await writes.run(async () => {
        if (disposed) {
          return;
        }
        const count = Math.max(THREAD_CATALOG_PAGE_SIZE, prefixIds.size);
        const [window, existing] = await Promise.all([
          storage.loadView({
            connectionId,
            ...(projectCwd === undefined ? {} : { projectCwd }),
            archivedLimit: archived ? count : 0,
            recentLimit: archived ? 0 : count,
            selectedConnectionId: null,
            selectedThreadId: null,
            subagentConnectionId: null,
            subagentLimit: 0,
          }),
          loadRows(
            connectionId,
            snapshots.map(({ thread }) => thread.id),
          ),
        ]);
        const visibleWindow = filterView(window);
        const current = new Map(existing.map((row) => [row.remoteThreadId, row]));
        const changes: import("./thread-summary-sqlite.native").ThreadSummaryChange[] = [];
        for (const row of replaceHead
          ? archived
            ? visibleWindow.archived
            : visibleWindow.recent
          : []) {
          // Paging a catalog must not erase device-owned unread state outside its head.
          if (
            options.globalSupervisorStorage?.mayPruneMissing(connectionId) !== false &&
            !prefixIds.has(row.remoteThreadId) &&
            !row.pinned &&
            row.unread === 0 &&
            row.deleteCommandId === null &&
            !read.changed.has(row.remoteThreadId)
          ) {
            // Evict only this stale cached prefix; absence is not a server
            // thread deletion, and older cached ranges are left untouched.
            changes.push({
              key: threadSummaryKey(connectionId, row.remoteThreadId),
              type: "delete",
            });
          }
        }
        for (const snapshot of snapshots) {
          if (read.changed.has(snapshot.thread.id)) {
            continue;
          }
          const storageDecision = storageDecisionForThread(connectionId, {
            id: snapshot.thread.id,
            source: snapshot.thread.threadSource,
          });
          if (storageDecision === "delete") {
            changes.push({
              key: threadSummaryKey(connectionId, snapshot.thread.id),
              type: "delete",
            });
            continue;
          }
          if (storageDecision === "preserve") {
            continue;
          }
          const previous = current.get(snapshot.thread.id);
          const row = projectThreadSummarySnapshot(
            connectionId,
            snapshot.thread,
            archived,
            previous,
          );
          if (previous === undefined || !sameThreadSummary(previous, row)) {
            changes.push({ type: previous === undefined ? "insert" : "update", value: row });
          }
        }
        if (changes.length === 0) {
          return;
        }
        storage.begin();
        for (const change of changes) {
          storage.write(change);
        }
        const checkpoint = storage.commit({ durable: true });
        publishModelChanges(changes, true);
        await checkpoint;
      });
    },
    async applyCommandDelivery(delivery) {
      await applyDeleteDelivery(delivery);
    },
    async applyEvents(connectionId, events) {
      await writes.run(async () => {
        if (disposed || events.length === 0) {
          return;
        }
        const threadIds = [
          ...new Set(
            events.flatMap((event) => {
              const threadId = threadIdFromEvent(event.payload);
              return threadId === null ? [] : [threadId];
            }),
          ),
        ];
        const existing = await loadRows(connectionId, threadIds);
        const current = new Map(
          existing.map((row) => [threadSummaryKey(row.connectionId, row.remoteThreadId), row]),
        );
        const changed = new Map<string, StoredThreadSummary | null>();
        for (const event of events) {
          const eventParams = unknownRecord(event.payload.params);
          const eventThread = unknownRecord(eventParams?.thread);
          if (typeof eventThread?.id === "string") {
            const storageDecision = storageDecisionForThread(connectionId, {
              id: eventThread.id,
              source:
                typeof eventThread.threadSource === "string" ? eventThread.threadSource : null,
            });
            if (storageDecision === "delete") {
              changed.set(threadSummaryKey(connectionId, eventThread.id), null);
              continue;
            }
            if (storageDecision === "preserve") {
              continue;
            }
          }
          const mutation = projectThreadSummaryEvent(
            connectionId,
            event.payload,
            (threadId) => {
              const key = threadSummaryKey(connectionId, threadId);
              return changed.get(key) ?? current.get(key) ?? undefined;
            },
            undefined,
            event.cursor,
          );
          if (mutation !== null) {
            if (mutation.value === null) {
              changed.set(mutation.key, null);
              continue;
            }
            const storageDecision = storageDecisionForRef(
              mutation.value.connectionId,
              mutation.value.remoteThreadId,
            );
            if (storageDecision === "preserve") {
              continue;
            }
            changed.set(mutation.key, storageDecision === "delete" ? null : mutation.value);
          }
        }
        if (changed.size === 0) {
          return;
        }
        storage.begin();
        for (const [key, row] of changed) {
          if (row === null) {
            storage.write({ key, type: "delete" });
          } else {
            const previous = current.get(key);
            storage.write({ type: previous === undefined ? "insert" : "update", value: row });
          }
        }
        const checkpoint = storage.commit({ durable: true });
        publishModelChanges(
          [...changed].map(([key, row]) =>
            row === null
              ? { key, type: "delete" as const }
              : { type: current.has(key) ? ("update" as const) : ("insert" as const), value: row },
          ),
          [...changed].some(([key, row]) => {
            if (row === null) {
              return true;
            }
            const previous = current.get(key);
            return previous !== undefined && summaryViewMembershipChanged(previous, row);
          }),
        );
        await checkpoint;
      });
    },
    async applySnapshot(connectionId, snapshots) {
      await replaceSnapshotRows(
        connectionId,
        snapshots,
        (current) =>
          new Set(
            current
              .filter((row) => !retainThreadSummaryMissingFromSnapshot(row))
              .map((row) => threadSummaryKey(row.connectionId, row.remoteThreadId)),
          ),
      );
    },
    beginCatalogRead: (connectionId) => catalogReads.begin(connectionId),
    async beginDelete(connectionId, threadId, commandId) {
      const row = await loadRow(connectionId, threadId);
      if (row === undefined) {
        return;
      }
      await publish({ ...row, deleteCommandId: commandId });
    },
    close() {
      disposed = true;
      model.close();
      projectUnread.close();
      void storage.close().catch((error: unknown) => {
        appLogger.warnCaught({ error: error, event: "thread_summary.close.failed" });
      });
    },
    async get(connectionId, threadId) {
      return (await loadRow(connectionId, threadId)) ?? null;
    },
    async insertStartedThread(connectionId, thread) {
      const storageDecision = storageDecisionForThread(connectionId, {
        id: thread.id,
        source: thread.threadSource,
      });
      if (storageDecision === "delete") {
        await remove(threadSummaryKey(connectionId, thread.id));
        return;
      }
      if (storageDecision === "preserve") {
        return;
      }
      const previous = await loadRow(connectionId, thread.id);
      const mutation = projectThreadSummaryEvent(
        connectionId,
        {
          codewideThreadPatch: {
            operation: { kind: "threadStarted", thread },
            threadId: thread.id,
            version: 1,
          },
          method: "thread/started",
          params: { thread },
        },
        () => previous,
      );
      if (mutation?.value !== null && mutation?.value !== undefined) {
        await publish(mutation.value);
      }
    },
    loadView,
    async markRead(connectionId, threadId) {
      const row = await loadRow(connectionId, threadId);
      if (row !== undefined) {
        await publish({ ...row, lastSeenCursor: row.latestActivityCursor, unread: 0 });
      }
    },
    async mergeSnapshots(connectionId, snapshots) {
      await writes.run(async () => {
        if (disposed || snapshots.length === 0) {
          return;
        }
        const existing = await loadRows(
          connectionId,
          snapshots.map(({ thread }) => thread.id),
        );
        const current = new Map(
          existing.map((row) => [threadSummaryKey(row.connectionId, row.remoteThreadId), row]),
        );
        const changed = new Map<string, StoredThreadSummary>();
        const removed = new Set<string>();
        for (const snapshot of snapshots) {
          if (snapshot.thread.ephemeral) {
            continue;
          }
          const key = threadSummaryKey(connectionId, snapshot.thread.id);
          const storageDecision = storageDecisionForThread(connectionId, {
            id: snapshot.thread.id,
            source: snapshot.thread.threadSource,
          });
          if (storageDecision === "delete") {
            removed.add(key);
            continue;
          }
          if (storageDecision === "preserve") {
            continue;
          }
          const previous = current.get(key);
          const row = projectThreadSummarySnapshot(
            connectionId,
            snapshot.thread,
            snapshot.archived,
            previous,
          );
          if (previous === undefined || !sameThreadSummary(previous, row)) {
            changed.set(key, row);
          }
        }
        if (changed.size === 0 && removed.size === 0) {
          return;
        }
        storage.begin();
        for (const key of removed) {
          storage.write({ key, type: "delete" });
        }
        for (const [key, row] of changed) {
          const previous = current.get(key);
          storage.write({ type: previous === undefined ? "insert" : "update", value: row });
        }
        const checkpoint = storage.commit({ durable: true });
        publishModelChanges(
          [
            ...[...removed].map((key) => ({ key, type: "delete" as const })),
            ...[...changed].map(([key, row]) => ({
              ...(current.has(key) ? { type: "update" as const } : { type: "insert" as const }),
              value: row,
            })),
          ],
          removed.size > 0 ||
            [...changed].some(([key, row]) => {
              const previous = current.get(key);
              return previous !== undefined && summaryViewMembershipChanged(previous, row);
            }),
        );
        await checkpoint;
      });
    },
    model,
    async prepare() {
      await storage.prepare();
      const hidden = (await storage.loadAll()).filter(
        (row) =>
          options.globalSupervisorStorage?.shouldDeletePersistedRef(
            row.connectionId,
            row.remoteThreadId,
          ) === true,
      );
      if (hidden.length > 0) {
        storage.begin();
        for (const row of hidden) {
          storage.write({
            key: threadSummaryKey(row.connectionId, row.remoteThreadId),
            type: "delete",
          });
        }
        await storage.commit({ durable: true });
      }
      await projectUnread.resource(async () => visibleRows(await storage.loadUnread()));
    },
    projectUnread,
    async reconcileDeleteCommands(deliveries) {
      const byId = new Map(
        deliveries.map((delivery) => [
          `${delivery.connectionId}\u0000${delivery.commandId}`,
          delivery,
        ]),
      );
      for (const row of await storage.loadAll()) {
        if (row.deleteCommandId === null) {
          continue;
        }
        const delivery = byId.get(`${row.connectionId}\u0000${row.deleteCommandId}`);
        if (delivery === undefined || delivery.state === "failed") {
          await publish({ ...row, deleteCommandId: null });
        } else if (delivery.state === "delivered") {
          await applyDeleteDelivery(delivery);
        }
      }
    },
    async replaceCatalog(connectionId, snapshots) {
      await replaceSnapshotRows(
        connectionId,
        snapshots,
        (current) =>
          new Set(
            current
              .filter((row) => !retainThreadSummaryMissingFromSnapshot(row))
              .map((row) => threadSummaryKey(row.connectionId, row.remoteThreadId)),
          ),
      );
    },
    async replaceSubagentCatalog(connectionId, rootThreadId, snapshots) {
      const projected = snapshots.filter(({ thread }) => thread.parentThreadId !== null);
      await replaceSnapshotRows(connectionId, projected, (current) =>
        threadSummaryDescendantKeys(current, rootThreadId),
      );
    },
    async rollbackDelete(connectionId, threadId, commandId) {
      const row = await loadRow(connectionId, threadId);
      if (row === undefined || row.deleteCommandId !== commandId) {
        return;
      }
      await publish({ ...row, deleteCommandId: null });
    },
    async search(query, connectionId = null) {
      const needle = query.trim().toLocaleLowerCase();
      if (needle === "") {
        return [];
      }
      const rows =
        connectionId === null
          ? visibleRows(await storage.loadAll())
          : await loadConnectionRows(connectionId);
      return rows
        .filter(
          (row) =>
            row.deleteCommandId === null &&
            row.parentThreadId === null &&
            (connectionId === null || row.connectionId === connectionId) &&
            `${row.name ?? ""}\n${row.preview}`.toLocaleLowerCase().includes(needle),
        )
        .sort(compareThreadSummaryRecency)
        .slice(0, 200);
    },
    setCatalogLoader(loader) {
      catalogLoader = loader;
    },
    setRenameHandler(handler) {
      renameHandler = handler;
    },
    async updateArchived(connectionId, threadId, archived) {
      const row = await loadRow(connectionId, threadId);
      if (row !== undefined) {
        await publish({ ...row, archived });
      }
    },
    async updateName(connectionId, threadId, name) {
      if (renameHandler === null) {
        throw new Error("Thread rename transport is not ready");
      }
      await renameHandler(connectionId, threadId, name);
      const row = await loadRow(connectionId, threadId);
      if (row !== undefined) {
        await publish({ ...row, name });
      }
    },
    async updatePinned(connectionId, threadId, pinned) {
      const row = await loadRow(connectionId, threadId);
      if (row !== undefined) {
        await publish({ ...row, pinned });
      }
    },
    viewResource(request) {
      return model.resource(request, async () => {
        const cached = await storage.loadView(request);
        if (catalogLoader !== null && (request.recentLimit > 0 || request.archivedLimit > 0)) {
          const updating = catalogLoader(request);
          const count = request.archivedLimit > 0 ? cached.archived.length : cached.recent.length;
          if (count === 0) {
            await updating;
            return storage.loadView(request);
          }
          void updating.catch((error: unknown) => {
            appLogger.warnCaught({ error: error, event: "thread_catalog.window_refresh.failed" });
          });
        }
        return cached;
      });
    },
  };
}

function sameThreadSummary(left: StoredThreadSummary, right: StoredThreadSummary): boolean {
  return (
    left.connectionId === right.connectionId &&
    left.remoteThreadId === right.remoteThreadId &&
    left.parentThreadId === right.parentThreadId &&
    left.agentNickname === right.agentNickname &&
    left.agentRole === right.agentRole &&
    left.name === right.name &&
    left.preview === right.preview &&
    left.cwd === right.cwd &&
    (left.gitOriginUrl ?? null) === (right.gitOriginUrl ?? null) &&
    left.updatedAt === right.updatedAt &&
    left.recencyAt === right.recencyAt &&
    left.status.type === right.status.type &&
    left.pinned === right.pinned &&
    left.archived === right.archived &&
    left.pendingRequestCount === right.pendingRequestCount &&
    left.latestActivityCursor === right.latestActivityCursor &&
    left.lastSeenCursor === right.lastSeenCursor &&
    left.unread === right.unread &&
    left.provisionalThread === right.provisionalThread &&
    left.deleteCommandId === right.deleteCommandId
  );
}

function compareThreadSummaryRecency(
  left: StoredThreadSummary,
  right: StoredThreadSummary,
): number {
  if (left.pinned !== right.pinned) {
    return left.pinned ? -1 : 1;
  }
  return (right.recencyAt ?? right.updatedAt) - (left.recencyAt ?? left.updatedAt);
}

function summaryViewMembershipChanged(
  left: StoredThreadSummary,
  right: StoredThreadSummary,
): boolean {
  return (
    left.connectionId !== right.connectionId ||
    left.cwd !== right.cwd ||
    left.parentThreadId !== right.parentThreadId ||
    left.pinned !== right.pinned ||
    left.archived !== right.archived ||
    left.deleteCommandId !== right.deleteCommandId
  );
}
