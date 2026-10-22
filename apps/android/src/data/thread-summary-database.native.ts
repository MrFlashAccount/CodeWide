import {
  reportedSubagentStatesOfBatch,
  rootsWithChangedSubagentActivity,
  withActiveSubagents,
  withReportedStatus,
} from "./threadSummarySubagentActivity";
import {
  isQuestionAnswerDelivery,
  projectQuestionAnswerDelivery,
} from "./questionAnswerProjection";
import { appLogger } from "../observability/logger";
import type {
  ThreadRenameHandler,
  ThreadSummaryDatabase,
  ThreadSummaryDatabaseOptions,
} from "./thread-summary-database-contract";

export type { ThreadSummaryDatabase } from "./thread-summary-database-contract";
import { threadIdFromEvent, type SyncEvent, type SyncSnapshotThread } from "@codewide/sync-client";

import type { NativeCommandDelivery } from "../native/native-transport";
import {
  normalizeStoredThreadSummary,
  threadSummaryProjectionCursor,
  type StoredThreadSummary,
} from "./thread-summary-types";
import {
  projectThreadSummaryEvent,
  projectThreadSummarySnapshot,
  retainThreadSummaryMissingFromSnapshot,
  threadSummaryDescendantKeys,
  threadSummaryEventAffectsDevice,
  threadSummaryKey,
  threadSummaryTurnAttention,
} from "./thread-summary-projection";
import { SerialTaskQueue } from "./serial-task-queue";
import { createThreadSummaryModel, type ThreadSummaryViewRequest } from "./thread-summary-model";
import type { ThreadSummaryChange } from "./thread-summary-sqlite.native";
import { createThreadSummarySqlite } from "./thread-summary-sqlite.native";
import { ThreadCatalogReads } from "./thread-catalog-read";
import { ProjectUnreadModel } from "./project-unread-model";
import { isCatalogExcluded } from "./threadCatalogMembership";
import { sameThreadAgent } from "./threadAgent";
import { createServerRowWriter } from "./threadSummaryServerRows";

const MAX_OVERLAY_THREADS = 256;
const MAX_OVERLAY_EVENTS_PER_THREAD = 64;

/**
 * Device-field events of threads that have no row yet, held in memory until a
 * server row arrives (bounded per connection; the oldest thread is dropped).
 * Nothing reaches SQLite for such a thread before its row.
 */
class PendingDeviceOverlay {
  readonly #connections = new Map<string, Map<string, SyncEvent[]>>();

  hold(connectionId: string, threadId: string, event: SyncEvent): void {
    let threads = this.#connections.get(connectionId);
    if (threads === undefined) {
      threads = new Map();
      this.#connections.set(connectionId, threads);
    }
    let events = threads.get(threadId);
    if (events === undefined) {
      if (threads.size >= MAX_OVERLAY_THREADS) {
        const oldest = threads.keys().next();
        if (oldest.done !== true) {
          threads.delete(oldest.value);
        }
      }
      events = [];
      threads.set(threadId, events);
    }
    events.push(event);
    if (events.length > MAX_OVERLAY_EVENTS_PER_THREAD) {
      events.shift();
    }
  }

  discard(connectionId: string, threadId: string): void {
    this.#connections.get(connectionId)?.delete(threadId);
  }

  /** Replays and drops a new row's held device-field events in their journal order. */
  replayInto(connectionId: string, row: StoredThreadSummary): StoredThreadSummary {
    const threads = this.#connections.get(connectionId);
    const events = threads?.get(row.remoteThreadId) ?? [];
    threads?.delete(row.remoteThreadId);
    let current = row;
    for (const event of events) {
      const mutation = projectThreadSummaryEvent(
        connectionId,
        event.payload,
        () => current,
        event.cursor,
      );
      if (mutation !== null && mutation.value !== null) {
        current = mutation.value;
      }
    }
    return current;
  }

  forgetConnection(connectionId: string): void {
    this.#connections.delete(connectionId);
  }
}

export function createThreadSummaryDatabase(
  options: ThreadSummaryDatabaseOptions,
): ThreadSummaryDatabase {
  const catalogReads = new ThreadCatalogReads();
  let catalogLoader: ((request: ThreadSummaryViewRequest) => Promise<boolean>) | null = null;
  let renameHandler: ThreadRenameHandler | null = null;
  let disposed = false;
  const writes = new SerialTaskQueue();
  const model = createThreadSummaryModel();
  const storage = createThreadSummarySqlite();
  const projectUnread = new ProjectUnreadModel();
  const overlay = new PendingDeviceOverlay();
  let refreshScheduled = false;

  const loadConnectionRows = storage.loadConnectionRows;
  const loadRows = storage.loadRows;
  const loadRow = async (
    connectionId: string,
    threadId: string,
  ): Promise<StoredThreadSummary | undefined> =>
    (await storage.loadRow(connectionId, threadId)) ?? undefined;

  const loadView = async (request: ThreadSummaryViewRequest): Promise<void> => {
    const generation = model.startView(request);
    try {
      model.commitView(request, generation, await storage.loadView(request));
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

  /** Reads and rewrites one row inside the write queue, so a concurrent live event is never lost. */
  const rewrite = async (
    connectionId: string,
    threadId: string,
    next: (previous: StoredThreadSummary | undefined) => StoredThreadSummary | null,
  ): Promise<void> => {
    await writes.run(async () => {
      if (disposed) {
        return;
      }
      const previous = await loadRow(connectionId, threadId);
      const row = next(previous);
      if (row === null) {
        return;
      }
      const normalized = normalizeStoredThreadSummary(row);
      const type = previous === undefined ? "insert" : "update";
      storage.begin();
      storage.write({ type, value: normalized });
      const checkpoint = storage.commit({ durable: true });
      publishModelChanges(
        [{ type, value: normalized }],
        previous !== undefined && summaryViewMembershipChanged(previous, normalized),
      );
      await checkpoint;
    });
  };

  const clearDeleteCommand = async (
    connectionId: string,
    threadId: string,
    commandId: string,
  ): Promise<void> => {
    await rewrite(connectionId, threadId, (previous) =>
      previous === undefined || previous.deleteCommandId !== commandId
        ? null
        : { ...previous, deleteCommandId: null },
    );
  };

  const setReadState = async (
    connectionId: string,
    threadId: string,
    unread: boolean,
  ): Promise<void> => {
    await writes.run(async () => {
      if (disposed) {
        return;
      }
      const row = await loadRow(connectionId, threadId);
      if (
        row === undefined ||
        (unread
          ? row.unread > 0
          : row.unread === 0 && row.lastSeenCursor === row.latestActivityCursor)
      ) {
        return;
      }
      const next = readStateSummary(row, unread);
      storage.begin();
      storage.write({ type: "update", value: next });
      const checkpoint = storage.commit({ durable: true });
      publishModelChanges(
        [{ type: "update", value: next }],
        summaryViewMembershipChanged(row, next),
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
      await clearDeleteCommand(delivery.connectionId, delivery.threadId, delivery.commandId);
    } else if (delivery.state === "delivered") {
      await remove(key);
    }
  };

  const applyQuestionDelivery = async (delivery: NativeCommandDelivery): Promise<void> => {
    if (!isQuestionAnswerDelivery(delivery) || delivery.threadId === null) {
      return;
    }
    const threadId = delivery.threadId;
    await writes.run(async () => {
      if (disposed) {
        return;
      }
      const row = await loadRow(delivery.connectionId, threadId);
      if (row === undefined) {
        return;
      }
      const next = projectQuestionAnswerDelivery(row, delivery);
      if (next === row) {
        return;
      }
      storage.begin();
      storage.write({ type: "update", value: next });
      const checkpoint = storage.commit({ durable: true });
      publishModelChanges([{ type: "update", value: next }]);
      await checkpoint;
    });
  };

  /** Recomputes one root's `activeSubagents` from its loaded descendants. */
  const refreshActiveSubagents = async (connectionId: string, rootThreadId: string) => {
    await writes.run(async () => {
      if (disposed) {
        return;
      }
      const rows = await loadConnectionRows(connectionId);
      const root = rows.find((row) => row.remoteThreadId === rootThreadId);
      if (root === undefined) {
        return;
      }
      const next = withActiveSubagents(root, rows);
      if (next === root) {
        return;
      }
      const change = { type: "update" as const, value: next };
      storage.begin();
      storage.write(change);
      const checkpoint = storage.commit({ durable: true });
      publishModelChanges([change], false);
      await checkpoint;
    });
  };

  const replaceSnapshotRows = async (
    connectionId: string,
    snapshots: SyncSnapshotThread[],
    options: {
      missingScope: (current: readonly StoredThreadSummary[]) => ReadonlySet<string>;
      projectMembership: (summary: StoredThreadSummary) => StoredThreadSummary;
      /**
       * An index read that does not know live status (a sub-agent row without
       * `running`) keeps a live `active` and newer recency, as catalog pages do.
       */
      retainLiveState: boolean;
      throughCursor: number | undefined;
    },
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
      const excludedKeys = new Set<string>();
      for (const snapshot of snapshots) {
        const key = threadSummaryKey(connectionId, snapshot.thread.id);
        const previous = current.get(key);
        if (
          previous !== undefined &&
          options.throughCursor !== undefined &&
          threadSummaryProjectionCursor(previous) > options.throughCursor
        ) {
          next.set(key, previous);
          continue;
        }
        if (isCatalogExcluded(snapshot.thread)) {
          excludedKeys.add(key);
          continue;
        }
        const projected = options.projectMembership(
          projectThreadSummarySnapshot(connectionId, snapshot.thread, snapshot.archived, previous),
        );
        const row =
          options.retainLiveState && previous !== undefined
            ? retainLiveCatalogState(projected, previous)
            : projected;
        row.projectionCursor = Math.max(
          threadSummaryProjectionCursor(row),
          options.throughCursor ?? 0,
        );
        next.set(key, row);
      }
      const removableKeys = new Set([...options.missingScope(currentRows), ...excludedKeys]);
      const removed = [...current].filter(
        ([key, row]) =>
          !next.has(key) &&
          removableKeys.has(key) &&
          (options.throughCursor === undefined ||
            threadSummaryProjectionCursor(row) <= options.throughCursor),
      );
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

  /**
   * Adds to `changed` the root rows whose sub-agents started or stopped
   * running with this batch. Only a child's status change reads the
   * connection's rows; streamed content does not.
   */
  const applySubagentActivity = async (
    connectionId: string,
    current: ReadonlyMap<string, StoredThreadSummary>,
    changed: Map<string, StoredThreadSummary | null>,
  ): Promise<void> => {
    const children = [...changed].flatMap(([key, row]) =>
      row !== null &&
      row.parentThreadId !== null &&
      current.get(key)?.status.type !== row.status.type
        ? [row]
        : [],
    );
    if (children.length === 0) {
      return;
    }
    const rows = new Map(
      (await loadConnectionRows(connectionId)).map((row) => [
        threadSummaryKey(row.connectionId, row.remoteThreadId),
        row,
      ]),
    );
    for (const [key, row] of changed) {
      if (row === null) {
        rows.delete(key);
      } else {
        rows.set(key, row);
      }
    }
    for (const root of rootsWithChangedSubagentActivity(children, [...rows.values()])) {
      changed.set(threadSummaryKey(root.connectionId, root.remoteThreadId), root);
    }
  };

  /**
   * Sets the status of a non-primary provider's sub-agents from their
   * parent's `collabAgentToolCall` (see `reportedSubagentStates`); their child
   * rows have no live events of their own.
   */
  const applyReportedSubagentStates = async (batch: {
    readonly changed: Map<string, StoredThreadSummary | null>;
    readonly connectionId: string;
    readonly current: Map<string, StoredThreadSummary>;
    readonly events: readonly SyncEvent[];
  }): Promise<void> => {
    const { changed, connectionId, current } = batch;
    const rowOf = (threadId: string) => {
      const key = threadSummaryKey(connectionId, threadId);
      return changed.get(key) ?? current.get(key);
    };
    const reported = reportedSubagentStatesOfBatch(
      batch.events.map((event) => ({
        parentThreadId: threadIdFromEvent(event.payload),
        payload: event.payload,
      })),
      rowOf,
    );
    if (reported.size === 0) {
      return;
    }
    for (const child of await loadRows(connectionId, [...reported.keys()])) {
      const key = threadSummaryKey(child.connectionId, child.remoteThreadId);
      const pending = changed.get(key);
      if (pending === null) {
        continue;
      }
      if (!current.has(key)) {
        current.set(key, child);
      }
      const next = withReportedStatus(
        pending ?? child,
        reported.get(child.remoteThreadId) === true,
      );
      if (next !== null) {
        changed.set(key, next);
      }
    }
  };

  const applyEventBatch = async (connectionId: string, events: SyncEvent[]): Promise<void> => {
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
      const rowOf = (threadId: string): StoredThreadSummary | undefined => {
        const key = threadSummaryKey(connectionId, threadId);
        return changed.has(key) ? (changed.get(key) ?? undefined) : current.get(key);
      };
      for (const event of events) {
        const threadId = threadIdFromEvent(event.payload);
        if (threadId !== null && isCatalogExcluded(event.payload)) {
          changed.set(threadSummaryKey(connectionId, threadId), null);
          continue;
        }
        const mutation = projectThreadSummaryEvent(
          connectionId,
          event.payload,
          rowOf,
          event.cursor,
        );
        if (mutation !== null) {
          changed.set(mutation.key, mutation.value);
        } else if (
          threadId !== null &&
          !changed.has(threadSummaryKey(connectionId, threadId)) &&
          !current.has(threadSummaryKey(connectionId, threadId)) &&
          threadSummaryEventAffectsDevice(event.payload)
        ) {
          // The server row may arrive after this event; its device fields wait in memory.
          overlay.hold(connectionId, threadId, event);
        }
      }
      await applyReportedSubagentStates({ changed, connectionId, current, events });
      if (changed.size === 0) {
        return;
      }
      await applySubagentActivity(connectionId, current, changed);
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
  };

  const serverRows = createServerRowWriter({
    applySubagentActivity,
    disposed: () => disposed,
    listRace: options.listRace,
    onServerRows: options.onServerRows,
    overlay,
    publish: publishModelChanges,
    sameRow: sameThreadSummary,
    storage,
    viewMembershipChanged: summaryViewMembershipChanged,
    writes,
  });

  return {
    acknowledgePinMigration: storage.acknowledgePinMigration,
    applyCatalogPage: serverRows.applyCatalogPage,
    async applyCommandDelivery(delivery) {
      await applyDeleteDelivery(delivery);
      await applyQuestionDelivery(delivery);
    },
    async applyEvents(connectionId, events) {
      await applyEventBatch(connectionId, events);
    },
    async applyPinSnapshot(connectionId, snapshot) {
      await writes.run(async () => {
        if (disposed) {
          return;
        }
        const rows = await loadConnectionRows(connectionId);
        const pinnedIds = new Set(snapshot.threadIds);
        const changes: ThreadSummaryChange[] = [];
        storage.begin();
        for (const row of rows) {
          if ((row.pinCursor ?? 0) > snapshot.cursor) {
            continue;
          }
          const value = {
            ...row,
            pinCursor: snapshot.cursor,
            pinned: pinnedIds.has(row.remoteThreadId),
          };
          if (sameThreadSummary(row, value)) {
            continue;
          }
          const change = { type: "update" as const, value };
          storage.write(change);
          changes.push(change);
        }
        const checkpoint = storage.commit({ durable: true });
        publishModelChanges(changes, changes.length > 0);
        await checkpoint;
      });
    },
    applyServerRows: serverRows.applyServerRows,
    applySnapshot: serverRows.applySnapshot,
    beginCatalogRead: (connectionId) => catalogReads.begin(connectionId),
    async beginDelete(connectionId, threadId, commandId) {
      await rewrite(connectionId, threadId, (previous) =>
        previous === undefined ? null : { ...previous, deleteCommandId: commandId },
      );
    },
    close() {
      disposed = true;
      model.close();
      projectUnread.close();
      void storage.close().catch((error: unknown) => {
        appLogger.warnCaught({ error: error, event: "thread_summary.close.failed" });
      });
    },
    async deleteConnection(connectionId) {
      overlay.forgetConnection(connectionId);
      await writes.run(async () => {
        const rows = await loadConnectionRows(connectionId);
        if (rows.length === 0) {
          return;
        }
        const changes = rows.map((row) => ({
          key: threadSummaryKey(connectionId, row.remoteThreadId),
          type: "delete" as const,
        }));
        storage.begin();
        for (const change of changes) {
          storage.write(change);
        }
        const checkpoint = storage.commit({ durable: true });
        publishModelChanges(changes, true);
        await checkpoint;
      });
    },
    async ensureCatalog(request) {
      const remoteContinuation = catalogLoader === null ? false : await catalogLoader(request);
      return remoteContinuation || storage.hasMoreViewRows(request);
    },
    async get(connectionId, threadId) {
      return (await loadRow(connectionId, threadId)) ?? null;
    },
    async insertStartedThread(connectionId, thread) {
      if (isCatalogExcluded(thread)) {
        await remove(threadSummaryKey(connectionId, thread.id));
        return;
      }
      await rewrite(
        connectionId,
        thread.id,
        (previous) =>
          projectThreadSummaryEvent(
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
          )?.value ?? null,
      );
    },
    loadPendingPinMigration: storage.loadPendingPinMigration,
    loadView,
    async markProjectRead(connectionId, projectCwd) {
      await writes.run(async () => {
        if (disposed) {
          return;
        }
        const rows = await storage.loadProjectUnread(connectionId, projectCwd);
        if (rows.length === 0) {
          return;
        }
        // The write queue captures each chat's current activity boundary. Events
        // queued after this action remain unread, including in running chats.
        const changes = rows.map((row) => ({
          type: "update" as const,
          value: {
            ...row,
            firstUnreadAgentTurnId: null,
            lastSeenCursor: row.latestActivityCursor,
            unread: 0,
          },
        }));
        storage.begin();
        for (const change of changes) {
          storage.write(change);
        }
        await storage.commit({ durable: true });
        publishModelChanges(changes);
      });
    },
    async markRead(connectionId, threadId) {
      await setReadState(connectionId, threadId, false);
    },
    async markUnread(connectionId, threadId) {
      await setReadState(connectionId, threadId, true);
    },
    async mergeSnapshots(connectionId, snapshots, throughCursor) {
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
          const key = threadSummaryKey(connectionId, snapshot.thread.id);
          if (isCatalogExcluded(snapshot.thread)) {
            removed.add(key);
            continue;
          }
          const previous = current.get(key);
          // A bounded thread read can finish after a newer live event has
          // already updated the row. Never let that older read reopen a
          // completed question.
          if (
            previous !== undefined &&
            throughCursor !== undefined &&
            threadSummaryProjectionCursor(previous) > throughCursor
          ) {
            continue;
          }
          // Server fields of an existing row belong to Companion list rows; a
          // read only seeds a missing row and refreshes turn-derived attention.
          const row =
            previous === undefined
              ? projectThreadSummarySnapshot(connectionId, snapshot.thread, snapshot.archived)
              : { ...previous, ...threadSummaryTurnAttention(snapshot.thread, previous) };
          row.projectionCursor = Math.max(threadSummaryProjectionCursor(row), throughCursor ?? 0);
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
      await projectUnread.resource(async () => storage.loadUnread());
    },
    projectUnread,
    async reconcileCommands(deliveries) {
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
          await clearDeleteCommand(row.connectionId, row.remoteThreadId, row.deleteCommandId);
        } else if (delivery.state === "delivered") {
          await applyDeleteDelivery(delivery);
        }
      }
      for (const delivery of deliveries) {
        await applyQuestionDelivery(delivery);
      }
    },
    async removeCatalogEntries(connectionId, threadIds) {
      if (threadIds.length === 0) {
        return;
      }
      await writes.run(async () => {
        if (disposed) {
          return;
        }
        const rows = await storage.loadRows(connectionId, threadIds);
        if (rows.length === 0) {
          return;
        }
        const changes = rows.map((row) => ({
          key: threadSummaryKey(connectionId, row.remoteThreadId),
          type: "delete" as const,
        }));
        storage.begin();
        for (const change of changes) {
          storage.write(change);
        }
        const checkpoint = storage.commit({ durable: true });
        publishModelChanges(changes, true);
        await checkpoint;
      });
    },
    async replaceCatalog(connectionId, snapshots) {
      await replaceSnapshotRows(connectionId, snapshots, {
        missingScope: (current) =>
          new Set(
            current
              .filter((row) => !retainThreadSummaryMissingFromSnapshot(row))
              .map((row) => threadSummaryKey(row.connectionId, row.remoteThreadId)),
          ),
        // An authoritative snapshot replaces the rows it lists as they are.
        projectMembership: preserveSubagentMembership,
        retainLiveState: false,
        throughCursor: undefined,
      });
    },
    async replaceSubagentCatalog(connectionId, rootThreadId, snapshots) {
      const projected = snapshots.filter(({ thread }) => thread.parentThreadId !== null);
      await replaceSnapshotRows(connectionId, projected, {
        missingScope: (current) => threadSummaryDescendantKeys(current, rootThreadId),
        projectMembership: (summary) => assignSubagentMembership(summary, rootThreadId),
        retainLiveState: true,
        throughCursor: undefined,
      });
      await refreshActiveSubagents(connectionId, rootThreadId);
    },
    async rollbackDelete(connectionId, threadId, commandId) {
      await clearDeleteCommand(connectionId, threadId, commandId);
    },
    async search(query, connectionId = null) {
      const needle = query.trim().toLocaleLowerCase();
      if (needle === "") {
        return [];
      }
      const rows =
        connectionId === null ? await storage.loadAll() : await loadConnectionRows(connectionId);
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
    async skipQuestion(request) {
      await writes.run(async () => {
        const row = await loadRow(request.connectionId, request.threadId);
        if (disposed || row === undefined) {
          throw new Error("Question thread is unavailable");
        }
        const previousIds =
          row.skippedQuestions?.turnId === request.turnId ? row.skippedQuestions.itemIds : [];
        if (previousIds.includes(request.itemId)) {
          return;
        }
        const next: StoredThreadSummary = {
          ...row,
          skippedQuestions: { itemIds: [...previousIds, request.itemId], turnId: request.turnId },
        };
        storage.begin();
        storage.write({ type: "update", value: next });
        await storage.commit({ durable: true });
        publishModelChanges([{ type: "update", value: next }]);
      });
    },
    async updateArchived(connectionId, threadId, archived) {
      await rewrite(connectionId, threadId, (previous) =>
        previous === undefined ? null : { ...previous, archived },
      );
    },
    async updateName(connectionId, threadId, name) {
      if (renameHandler === null) {
        throw new Error("Thread rename transport is not ready");
      }
      await renameHandler(connectionId, threadId, name);
      await rewrite(connectionId, threadId, (previous) =>
        previous === undefined ? null : { ...previous, name },
      );
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

/**
 * Keeps live state that a paginated catalog row must not roll back.
 *
 * The page comes from the provider state store and may describe an earlier moment than events
 * already applied to the row. A listed `notLoaded` only says the provider does not hold the thread
 * in memory; a turn that runs elsewhere is still active, and its end arrives as an ordered
 * lifecycle event. Recency, which orders the list, never moves backwards.
 */
function retainLiveCatalogState(
  page: StoredThreadSummary,
  previous: StoredThreadSummary,
): StoredThreadSummary {
  if (page.status.type === "notLoaded" && previous.status.type === "active") {
    page.status = previous.status;
  }
  if (
    previous.recencyAt !== null &&
    (page.recencyAt === null || page.recencyAt < previous.recencyAt)
  ) {
    page.recencyAt = previous.recencyAt;
  }
  return page;
}

function assignSubagentMembership(
  summary: StoredThreadSummary,
  rootThreadId: string,
): StoredThreadSummary {
  summary.subagentRootThreadId = rootThreadId;
  return summary;
}

function preserveSubagentMembership(summary: StoredThreadSummary): StoredThreadSummary {
  return summary;
}

function sameThreadSummary(left: StoredThreadSummary, right: StoredThreadSummary): boolean {
  return (
    left.connectionId === right.connectionId &&
    left.remoteThreadId === right.remoteThreadId &&
    left.parentThreadId === right.parentThreadId &&
    left.subagentRootThreadId === right.subagentRootThreadId &&
    left.agentNickname === right.agentNickname &&
    left.agentRole === right.agentRole &&
    left.name === right.name &&
    left.preview === right.preview &&
    left.cwd === right.cwd &&
    (left.gitOriginUrl ?? null) === (right.gitOriginUrl ?? null) &&
    sameThreadAgent(left.codewideAgent ?? null, right.codewideAgent ?? null) &&
    left.updatedAt === right.updatedAt &&
    left.recencyAt === right.recencyAt &&
    left.status.type === right.status.type &&
    (left.activeSubagents ?? false) === (right.activeSubagents ?? false) &&
    left.pinned === right.pinned &&
    left.pinCursor === right.pinCursor &&
    left.archived === right.archived &&
    left.pendingRequestCount === right.pendingRequestCount &&
    left.closedQuestionTurnId === right.closedQuestionTurnId &&
    sameQuestionOpportunity(left.pendingQuestion, right.pendingQuestion) &&
    sameQuestionOpportunity(left.skippedQuestions, right.skippedQuestions) &&
    sameQuestionOpportunity(left.submittedQuestions, right.submittedQuestions) &&
    (left.status.type !== "active" ||
      right.status.type !== "active" ||
      (left.status.activeFlags.length === right.status.activeFlags.length &&
        left.status.activeFlags.every(
          (flag, index) =>
            right.status.type === "active" && flag === right.status.activeFlags[index],
        ))) &&
    left.projectionCursor === right.projectionCursor &&
    left.latestActivityCursor === right.latestActivityCursor &&
    left.lastSeenCursor === right.lastSeenCursor &&
    (left.firstUnreadAgentTurnId ?? null) === (right.firstUnreadAgentTurnId ?? null) &&
    left.unread === right.unread &&
    left.provisionalThread === right.provisionalThread &&
    left.deleteCommandId === right.deleteCommandId
  );
}

function readStateAgentBoundary(row: StoredThreadSummary, unread: boolean): string | null {
  return unread ? (row.firstUnreadAgentTurnId ?? null) : null;
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
    left.subagentRootThreadId !== right.subagentRootThreadId ||
    left.pinned !== right.pinned ||
    left.archived !== right.archived ||
    left.deleteCommandId !== right.deleteCommandId
  );
}

function sameQuestionOpportunity(
  left: StoredThreadSummary["pendingQuestion"],
  right: StoredThreadSummary["pendingQuestion"],
): boolean {
  if (left === right) {
    return true;
  }
  if (left === null || left === undefined || right === null || right === undefined) {
    return false;
  }
  return (
    left.turnId === right.turnId &&
    left.itemIds.length === right.itemIds.length &&
    left.itemIds.every((id, index) => id === right.itemIds[index])
  );
}

function readStateSummary(row: StoredThreadSummary, unread: boolean): StoredThreadSummary {
  return {
    ...row,
    firstUnreadAgentTurnId: readStateAgentBoundary(row, unread),
    lastSeenCursor: unread ? row.lastSeenCursor : row.latestActivityCursor,
    unread: unread ? 1 : 0,
  };
}
