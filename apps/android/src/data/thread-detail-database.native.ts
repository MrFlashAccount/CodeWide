import type { Thread, Turn } from "@codewide/codex-protocol/v0.147.0/v2";
import {
  applyThreadProjectionPatchesImmutable,
  legacyThreadProjectionPatch,
  preserveProjectedTurnMetadata,
  projectedTurnMetadata,
  threadIdFromEvent,
  threadProjectionPatchFromEvent,
  type ThreadProjectionPatchV1,
  type ProjectedTurnMetadata,
  type SyncEvent,
  type SyncSnapshotThread,
} from "@codewide/sync-client";
import type { Collection } from "@tanstack/react-db";

import { createPersistentCollectionModel } from "./persistent-collection.native";
import { getUiCacheSqliteDatabase, registerUiCacheCollectionFlusher } from "./ui-cache-persistence.native";
import {
  compactCompletedTurnForStorage,
  authoritativeTimelineRowId,
  materializeThreadDetail,
  mergePendingTimelineOverlays,
  mergePendingTimelineEntry,
  reconcileAuthoritativeThreadDetailRow,
  reconcileAuthoritativeThread,
  shouldWriteAuthoritativeThreadDetailRow,
  shouldWriteHydratedActivityRow,
  shouldWriteThreadDetailRow,
  pendingTimelineRowId,
  planPendingDeliveryProjectionCleanup,
  planQueuedEditMutation,
  planQueuedMoveMutation,
  planQueuedRemovalMutation,
  projectAuthoritativeHistoryEpoch,
  projectAuthoritativeTurnOrdinals,
  projectPrependedTurnOrdinals,
  reusableTurnOrdinal,
  type PendingTimelineOverlay,
  type PendingTimelineEntry,
  type PendingTimelineMutation,
  type ThreadDetailRow,
} from "./thread-detail-projection";
import type { HostQueuedPrompt } from "./queue-event";
import type { NativeCommandDelivery } from "../native/native-transport";
import type { ThreadEventProjection } from "./thread-projection-store";
import { invalidationCanBeCleared, latestThreadInvalidations } from "./thread-detail-invalidation";
import { parseQueuedInput } from "./queued-input";
import { SerialTaskQueue } from "./serial-task-queue";
import {
  createThreadChatModel,
  threadChatRequestKey,
  threadChatScope,
  type ThreadChatModel,
  type ThreadChatWindowRequest,
  type ThreadChatWindowResource,
  type ThreadChatWindowSnapshot,
} from "./thread-chat-model";
import { setThreadDetailResidentRows } from "./operational-metrics";
import { createThreadDetailSqlite, type ThreadDetailSqliteControls } from "./thread-detail-sqlite.native";
import { ThreadWindowIntentController } from "./thread-window-intent";

const THREAD_DETAIL_COLLECTION_ID = "thread-details-v2";
const THREAD_INVALIDATION_COLLECTION_ID = "thread-detail-invalidations-v1";
const DURABLE_LIVE_BOUNDARIES = new Set([
  "turn/started",
  "turn/completed",
  "thread/status/changed",
  "thread/deleted",
]);

export { materializePendingTimeline, materializeThreadDetails, materializeThreadTurns } from "./thread-detail-projection";
export type { PendingTimelineEntry, ThreadDetailRow, ThreadDetailSnapshot } from "./thread-detail-projection";

export type ThreadDetailDatabase = {
  readonly sessionId: string;
  readonly chat: ThreadChatModel;
  prepare(): Promise<void>;
  windowResource(request: ThreadChatWindowRequest): ThreadChatWindowResource;
  preloadWindow(request: ThreadChatWindowRequest): () => void;
  retainWindow(connectionId: string, threadId: string): () => void;
  adoptPreloadedWindow(connectionId: string, threadId: string): void;
  loadWindow(request: ThreadChatWindowRequest): Promise<void>;
  readWindowRows(snapshot: ThreadChatWindowSnapshot): {
    turnRows: ThreadDetailRow[];
    detailRows: ThreadDetailRow[];
    liveRows: ThreadDetailRow[];
  };
  applySnapshot(connectionId: string, threads: SyncSnapshotThread[], cursor: number): Promise<void>;
  applyEvents(connectionId: string, events: SyncEvent[]): Promise<ThreadEventProjection>;
  captureRefreshCursor(connectionId: string, threadId: string): number;
  replaceThread(connectionId: string, thread: Thread, cleanThroughCursor?: number | null): Promise<void>;
  prependTurns(connectionId: string, threadId: string, expectedHistoryEpoch: number, turns: Turn[]): Promise<ThreadHistoryPrependResult>;
  replaceTurnItems(connectionId: string, threadId: string, turnId: string, items: Turn["items"]): Promise<void>;
  createPending(input: PendingTimelineInput): ThreadDetailRow;
  stagePendingMutation(mutation: PendingTimelineMutation): { rollback(): void; complete(): void };
  commitPending(row: ThreadDetailRow, options?: { durable?: boolean }): Promise<boolean>;
  commitPendingMutation(mutation: PendingTimelineMutation, options?: { durable?: boolean }): Promise<boolean>;
  applyCommandDelivery(delivery: NativeCommandDelivery): Promise<void>;
  reconcileNativeCommands(connectionId: string, threadId: string, deliveries: readonly NativeCommandDelivery[]): Promise<void>;
  replaceQueued(connectionId: string, threadId: string, commands: HostQueuedPrompt[], preserveCommandIds?: Set<string>): Promise<void>;
  hasPendingDelivery(connectionId: string, threadId: string, commandId: string): boolean;
  listQueued(connectionId: string, threadId: string): PendingTimelineEntry[];
  planQueuedEdit(connectionId: string, commandId: string, text: string, attachments: PendingTimelineEntry["attachments"]): PendingTimelineMutation | null;
  planQueuedRemoval(connectionId: string, commandId: string): PendingTimelineMutation | null;
  planQueuedMove(connectionId: string, threadId: string, commandId: string, direction: -1 | 1): PendingTimelineMutation | null;
  getThread(connectionId: string, threadId: string): Thread | null;
  close(): Promise<void>;
};

export type ThreadHistoryPrependResult = {
  accepted: boolean;
  historyEpoch: number;
  extendedMinimum: boolean;
};

export type PendingTimelineInput = Omit<PendingTimelineEntry, "order"> & { order?: number } & {
  connectionId: string;
  threadId: string;
};

type ThreadInvalidationRow = {
  id: string;
  connectionId: string;
  threadId: string;
  cursor: number;
};

type SyncControls = ThreadDetailSqliteControls;

type OrdinalBounds = { min: number; max: number; dirty: boolean };

/**
 * Incremental index over the rows the active Legend chat ranges hydrate. History can
 * grow to thousands of turns, so a live delta must never rebuild or scan the
 * whole collection just to find the mutable head.
 */
class ThreadDetailSource extends Map<string, ThreadDetailRow> {
  private readonly rowKeysByThread = new Map<string, Set<string>>();
  private readonly threadMetaKeysByConnection = new Map<string, Set<string>>();
  private readonly mutableTurnIdsByThreadEpoch = new Map<string, Set<string>>();
  private readonly turnOrdinalsByThreadEpoch = new Map<string, Map<string, number>>();
  private readonly turnRowKeysByRemoteId = new Map<string, Map<string, string>>();
  private readonly pendingRowKeysByCommandId = new Map<string, string>();
  private readonly ordinalBoundsByThreadEpoch = new Map<string, OrdinalBounds>();

  override set(key: string, row: ThreadDetailRow): this {
    const previous = super.get(key);
    if (previous !== undefined) this.detach(previous);
    super.set(key, row);
    this.attach(row);
    return this;
  }

  override delete(key: string): boolean {
    const previous = super.get(key);
    if (previous === undefined) return false;
    this.detach(previous);
    return super.delete(key);
  }

  override clear(): void {
    super.clear();
    this.rowKeysByThread.clear();
    this.threadMetaKeysByConnection.clear();
    this.mutableTurnIdsByThreadEpoch.clear();
    this.turnOrdinalsByThreadEpoch.clear();
    this.turnRowKeysByRemoteId.clear();
    this.pendingRowKeysByCommandId.clear();
    this.ordinalBoundsByThreadEpoch.clear();
  }

  replaceThreadLoaded(connectionId: string, threadId: string, rows: readonly ThreadDetailRow[]): void {
    const retained = new Set(rows.map(({ id }) => id));
    for (const row of this.rowsForThread(connectionId, threadId)) {
      if (!retained.has(row.id)) this.delete(row.id);
    }
    for (const row of rows) this.set(row.id, row);
  }

  removeThreadLoaded(connectionId: string, threadId: string): void {
    for (const row of this.rowsForThread(connectionId, threadId)) this.delete(row.id);
  }

  rowsForThread(connectionId: string, threadId: string): ThreadDetailRow[] {
    const keys = this.rowKeysByThread.get(threadScope(connectionId, threadId));
    if (keys === undefined) return [];
    const rows: ThreadDetailRow[] = [];
    for (const key of keys) {
      const row = super.get(key);
      if (row !== undefined) rows.push(row);
    }
    return rows;
  }

  historyEpoch(connectionId: string, threadId: string): number {
    const meta = super.get(threadMetaKey(connectionId, threadId));
    return meta?.kind === "thread" ? meta.historyEpoch : 0;
  }

  threadMetaRows(connectionId: string): ThreadDetailRow[] {
    const rows: ThreadDetailRow[] = [];
    for (const key of this.threadMetaKeysByConnection.get(connectionId) ?? []) {
      const row = super.get(key);
      if (row !== undefined) rows.push(row);
    }
    return rows;
  }

  liveRows(connectionId: string, threadId: string, patches: ThreadProjectionPatchV1[]): ThreadDetailRow[] {
    const historyEpoch = this.historyEpoch(connectionId, threadId);
    const selectedTurnIds = new Set(this.mutableTurnIdsByThreadEpoch.get(threadEpochScope(connectionId, threadId, historyEpoch)) ?? []);
    for (const patch of patches) {
      const operation = patch.operation;
      if (typeof operation.turnId === "string") selectedTurnIds.add(operation.turnId);
      const turn = operation.turn;
      if (turn !== null && typeof turn === "object" && !Array.isArray(turn) && typeof (turn as Record<string, unknown>).id === "string") {
        selectedTurnIds.add((turn as Record<string, unknown>).id as string);
      }
    }
    const rows: ThreadDetailRow[] = [];
    const meta = super.get(threadMetaKey(connectionId, threadId));
    if (meta !== undefined) rows.push(meta);
    for (const turnId of selectedTurnIds) {
      const contentKey = this.turnRowKey(connectionId, threadId, turnId);
      for (const key of [
        contentKey,
        turnMetaKey(connectionId, threadId, turnId),
        activityKey(connectionId, threadId, turnId),
      ]) {
        if (key === null) continue;
        const row = super.get(key);
        if (row !== undefined && (row.kind === "thread" || row.kind === "pending" || row.historyEpoch === historyEpoch)) rows.push(row);
      }
    }
    return rows;
  }

  turnRowKey(connectionId: string, threadId: string, turnId: string): string | null {
    return this.turnRowKeysByRemoteId.get(threadScope(connectionId, threadId))?.get(turnId) ?? null;
  }

  pendingRow(connectionId: string, commandId: string): ThreadDetailRow | undefined {
    const key = this.pendingRowKeysByCommandId.get(pendingCommandScope(connectionId, commandId));
    return key === undefined ? undefined : super.get(key);
  }

  ordinalBounds(connectionId: string, threadId: string, historyEpoch = this.historyEpoch(connectionId, threadId)): { min: number; max: number } | null {
    const scope = threadEpochScope(connectionId, threadId, historyEpoch);
    const ordinals = this.turnOrdinalsByThreadEpoch.get(scope);
    if (ordinals === undefined || ordinals.size === 0) return null;
    let bounds = this.ordinalBoundsByThreadEpoch.get(scope);
    if (bounds === undefined || bounds.dirty) {
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (const ordinal of ordinals.values()) {
        min = Math.min(min, ordinal);
        max = Math.max(max, ordinal);
      }
      bounds = { min, max, dirty: false };
      this.ordinalBoundsByThreadEpoch.set(scope, bounds);
    }
    return { min: bounds.min, max: bounds.max };
  }

  private attach(row: ThreadDetailRow): void {
    const scope = threadScope(row.connectionId, row.remoteThreadId);
    const keys = this.rowKeysByThread.get(scope) ?? new Set<string>();
    keys.add(row.id);
    this.rowKeysByThread.set(scope, keys);
    if (row.kind === "thread") {
      const metaKeys = this.threadMetaKeysByConnection.get(row.connectionId) ?? new Set<string>();
      metaKeys.add(row.id);
      this.threadMetaKeysByConnection.set(row.connectionId, metaKeys);
    }
    if (row.kind === "pending" && row.pending !== null && row.pending !== undefined) {
      this.pendingRowKeysByCommandId.set(pendingCommandScope(row.connectionId, row.pending.commandId), row.id);
      return;
    }
    if (row.kind !== "turn" || row.remoteTurnId === null) return;
    const turnKeys = this.turnRowKeysByRemoteId.get(scope) ?? new Map<string, string>();
    turnKeys.set(row.remoteTurnId, row.id);
    this.turnRowKeysByRemoteId.set(scope, turnKeys);
    const epochScope = threadEpochScope(row.connectionId, row.remoteThreadId, row.historyEpoch);
    const ordinals = this.turnOrdinalsByThreadEpoch.get(epochScope) ?? new Map<string, number>();
    ordinals.set(row.remoteTurnId, row.ordinal);
    this.turnOrdinalsByThreadEpoch.set(epochScope, ordinals);
    const bounds = this.ordinalBoundsByThreadEpoch.get(epochScope);
    if (bounds === undefined) this.ordinalBoundsByThreadEpoch.set(epochScope, { min: row.ordinal, max: row.ordinal, dirty: false });
    else if (!bounds.dirty) {
      bounds.min = Math.min(bounds.min, row.ordinal);
      bounds.max = Math.max(bounds.max, row.ordinal);
    }
    const mutable = this.mutableTurnIdsByThreadEpoch.get(epochScope) ?? new Set<string>();
    if (row.sealed) mutable.delete(row.remoteTurnId);
    else mutable.add(row.remoteTurnId);
    if (mutable.size === 0) this.mutableTurnIdsByThreadEpoch.delete(epochScope);
    else this.mutableTurnIdsByThreadEpoch.set(epochScope, mutable);
  }

  private detach(row: ThreadDetailRow): void {
    const scope = threadScope(row.connectionId, row.remoteThreadId);
    const keys = this.rowKeysByThread.get(scope);
    keys?.delete(row.id);
    if (keys?.size === 0) this.rowKeysByThread.delete(scope);
    if (row.kind === "thread") {
      const metaKeys = this.threadMetaKeysByConnection.get(row.connectionId);
      metaKeys?.delete(row.id);
      if (metaKeys?.size === 0) this.threadMetaKeysByConnection.delete(row.connectionId);
    }
    if (row.kind === "pending" && row.pending !== null && row.pending !== undefined) {
      const commandScope = pendingCommandScope(row.connectionId, row.pending.commandId);
      if (this.pendingRowKeysByCommandId.get(commandScope) === row.id) this.pendingRowKeysByCommandId.delete(commandScope);
      return;
    }
    if (row.kind !== "turn" || row.remoteTurnId === null) return;
    const turnKeys = this.turnRowKeysByRemoteId.get(scope);
    turnKeys?.delete(row.remoteTurnId);
    if (turnKeys?.size === 0) this.turnRowKeysByRemoteId.delete(scope);
    const epochScope = threadEpochScope(row.connectionId, row.remoteThreadId, row.historyEpoch);
    const ordinals = this.turnOrdinalsByThreadEpoch.get(epochScope);
    ordinals?.delete(row.remoteTurnId);
    if (ordinals?.size === 0) this.turnOrdinalsByThreadEpoch.delete(epochScope);
    const bounds = this.ordinalBoundsByThreadEpoch.get(epochScope);
    if (bounds !== undefined && (row.ordinal === bounds.min || row.ordinal === bounds.max)) bounds.dirty = true;
    const mutable = this.mutableTurnIdsByThreadEpoch.get(epochScope);
    mutable?.delete(row.remoteTurnId);
    if (mutable?.size === 0) this.mutableTurnIdsByThreadEpoch.delete(epochScope);
  }
}

export function createThreadDetailDatabase(): ThreadDetailDatabase {
  const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const source = new ThreadDetailSource();
  const chat = createThreadChatModel({
    onEvictWindow: (connectionId, threadId) => source.removeThreadLoaded(connectionId, threadId),
    onResidentRowCountChange: setThreadDetailResidentRows,
  });
  // A new thread can receive its first turn before React switches from the
  // synthetic New Chat scope to the real thread query. Keep only a bounded
  // set of those empty shells so their live events can restart the range
  // controller instead of being reduced to an invalidation that appears only
  // after reopening the conversation.
  const startedThreadShells = new Map<string, Thread>();
  const stagedPendingOverlays = new Map<string, PendingTimelineOverlay & { owner: number }>();
  let nextStagedPendingOwner = 1;
  let closing = false;
  let disposed = false;
  let closePromise: Promise<void> | null = null;
  const writes = new SerialTaskQueue();
  const windowIntents = new ThreadWindowIntentController();

  const detailStorage = createThreadDetailSqlite((changes) => {
    const touched = new Map<string, { connectionId: string; threadId: string }>();
    for (const change of changes) {
      const row = change.type === "delete" ? chat.row$(change.key).peek() : change.value;
      if (row !== null) touched.set(threadChatScope(row.connectionId, row.remoteThreadId), {
        connectionId: row.connectionId,
        threadId: row.remoteThreadId,
      });
    }
    chat.publishChanges(changes);
    for (const { connectionId, threadId } of touched.values()) {
      chat.refreshThread(connectionId, threadId, source.rowsForThread(connectionId, threadId));
    }
  });
  const unregisterDetailFlusher = registerUiCacheCollectionFlusher(THREAD_DETAIL_COLLECTION_ID, detailStorage.flush);
  const invalidationModel = createPersistentCollectionModel<ThreadInvalidationRow, string>({
    id: THREAD_INVALIDATION_COLLECTION_ID,
    tableName: "codewide_thread_invalidations",
    schemaVersion: 1,
    database: getUiCacheSqliteDatabase(),
    getKey: (row) => row.id,
    columns: [
      { property: "connectionId", column: "connection_id", type: "TEXT" },
      { property: "threadId", column: "thread_id", type: "TEXT" },
      { property: "cursor", column: "cursor", type: "REAL" },
    ],
    indexes: [["connectionId", "threadId"]],
    legacyCollectionId: THREAD_INVALIDATION_COLLECTION_ID,
  });
  const invalidations = invalidationModel.collection;
  const loadDurablePrependRows = async (
    connectionId: string,
    threadId: string,
    historyEpoch: number,
    turnIds: readonly string[],
  ): Promise<ThreadDetailRow[]> => {
    // The hot source intentionally contains only the resident chat range. Before a
    // cursor page decides whether it extends history, read exactly its turn
    // family plus the durable epoch minimum. This prevents cached-but-unloaded
    // rows from being reassigned new ordinals after process restart.
    return await detailStorage.loadPrependFacts(connectionId, threadId, historyEpoch, turnIds);
  };

  const loadDurableAuthoritativeRows = async (
    connectionId: string,
    threadId: string,
    incomingTurnIds: readonly string[],
  ): Promise<ThreadDetailRow[]> => {
    // Authoritative projection cannot rely on the current resident range: it
    // may still be loading or may not contain the incoming turn family. Read
    // only the durable facts required to
    // establish the current epoch and anchor this bounded server page.
    return await detailStorage.loadAuthoritativeFacts(connectionId, threadId, incomingTurnIds);
  };

  const ensureControls = (): SyncControls => {
    return detailStorage;
  };

  const writeOwnedRow = (controls: SyncControls, key: string, row: ThreadDetailRow): boolean => {
    // Once the server claims a stable client-id key, no older optimistic
    // transaction may roll it back or persist a pending tombstone over it.
    if (row.kind === "turn") stagedPendingOverlays.delete(key);
    return writeRow(source, controls, key, row);
  };

  const persistPendingMutation = async (
    mutation: PendingTimelineMutation,
    durable = false,
  ): Promise<boolean> => await writes.run(async () => {
    if (disposed) return false;
    const controls = ensureControls();
    controls.begin({ immediate: true });
    let changed = false;
    for (const key of mutation.deletes) {
      const previous = source.get(key);
      // An authoritative turn owns the stable client-id row forever. A late
      // queue receipt must never delete or replace real server content.
      if (previous?.kind === "turn") {
        stagedPendingOverlays.delete(key);
        continue;
      }
      if (previous?.kind === "pending") source.delete(key);
      if (previous?.kind === "pending" || stagedPendingOverlays.has(key)) {
        controls.write({ type: "delete", key });
        changed = true;
      }
    }
    for (const row of mutation.upserts) {
      if (row.kind !== "pending" || row.pending === null || row.pending === undefined) continue;
      const previous = source.get(row.id);
      if (previous?.kind === "turn") continue;
      const next = previous?.kind === "pending" && previous.pending !== null && previous.pending !== undefined
        ? { ...row, pending: mergePendingTimelineEntry(previous.pending, row.pending) }
        : row;
      if (writeOwnedRow(controls, next.id, next)) changed = true;
      else if (stagedPendingOverlays.has(next.id)) {
        controls.write({ type: "update", value: next });
        changed = true;
      }
    }
    if (!changed) await controls.commit();
    else await controls.commit({ durable });
    return true;
  });

  const persistPendingRow = async (row: ThreadDetailRow, durable = false): Promise<boolean> => (
    await persistPendingMutation({ upserts: [row], deletes: [] }, durable)
  );

  const applyCommandDelivery = async (delivery: NativeCommandDelivery): Promise<void> => {
    if (disposed) return;
    const direct = delivery.method === "turn/start" || delivery.method === "turn/steer";
    if (direct && delivery.threadId !== null) {
      const existing = source.pendingRow(delivery.connectionId, delivery.commandId);
      if (existing === undefined && !source.has(threadMetaKey(delivery.connectionId, delivery.threadId))) return;
      const entry: PendingTimelineEntry = {
        commandId: delivery.commandId,
        method: delivery.method === "turn/steer" ? "turn/steer" : "turn/start",
        presentation: existing?.pending?.presentation ?? "delivery",
        text: delivery.text,
        attachments: existing?.pending?.attachments ?? delivery.attachments,
        state: delivery.state,
        attempts: delivery.attempts,
        lastError: delivery.lastError,
        createdAt: delivery.createdAt,
        updatedAt: delivery.updatedAt,
        order: existing?.pending?.order ?? delivery.createdAt,
      };
      await persistPendingRow(pendingRow(delivery.connectionId, delivery.threadId, entry));
      return;
    }
    if (!delivery.method.startsWith("companion/queue/")) return;
    const commandId = delivery.targetCommandId;
    if (commandId === null) return;
    const current = source.pendingRow(delivery.connectionId, commandId);
    if (current?.kind !== "pending" || current.pending === null || current.pending === undefined) {
      if (delivery.method !== "companion/queue/put" || delivery.threadId === null) return;
      const state: PendingTimelineEntry["state"] = delivery.state === "delivered" ? "queued" : delivery.state;
      await persistPendingRow(pendingRow(delivery.connectionId, delivery.threadId, {
        commandId,
        method: "turn/start",
        presentation: "queue",
        text: delivery.text,
        attachments: delivery.attachments,
        state,
        attempts: delivery.attempts,
        lastError: delivery.lastError,
        createdAt: delivery.createdAt,
        updatedAt: delivery.updatedAt,
        order: delivery.createdAt,
      }));
      return;
    }
    if (delivery.method === "companion/queue/cancel" && delivery.state === "delivered") {
      await persistPendingMutation({ upserts: [], deletes: [current.id] });
      return;
    }
    const state: PendingTimelineEntry["state"] = delivery.state === "delivered" && delivery.method === "companion/queue/put"
      ? "queued"
      : delivery.state;
    await persistPendingRow({
      ...current,
      pending: {
        ...current.pending,
        state,
        attempts: Math.max(current.pending.attempts, delivery.attempts),
        lastError: delivery.lastError,
        updatedAt: delivery.updatedAt,
      },
    });
  };

  const publishThread = async (
    connectionId: string,
    incoming: Thread,
    mode: "authoritative" | "live" | "prepend",
    openedAt = Date.now(),
    preserveConcurrentHead = false,
  ): Promise<void> => {
    if (disposed) throw new Error("Thread detail database is closed");
    const controls = ensureControls();
    if (mode === "authoritative") {
      for (const row of await loadDurableAuthoritativeRows(
        connectionId,
        incoming.id,
        incoming.turns.map((turn) => turn.id),
      )) source.set(row.id, row);
    }
    const existingRows = source.rowsForThread(connectionId, incoming.id);
    const currentHistoryEpoch = source.historyEpoch(connectionId, incoming.id);
    const currentRows = existingRows.filter((row) => row.kind === "thread" || row.kind === "pending" || row.historyEpoch === currentHistoryEpoch);
    const projectedHistoryEpoch = projectAuthoritativeHistoryEpoch(existingRows, incoming.turns.map((turn) => turn.id));
    const historyEpoch = mode === "authoritative" ? projectedHistoryEpoch : currentHistoryEpoch;
    const authoritativeDisconnected = historyEpoch !== currentHistoryEpoch;
    const currentSnapshot = materializeThreadDetail(currentRows, connectionId, incoming.id, sessionId);
    const current = currentSnapshot?.thread;
    const authoritative = mode === "authoritative" && currentSnapshot?.fresh === true
      ? preserveProjectedTurnMetadata(incoming, current)
      : incoming;
    const thread = reconcileAuthoritativeThread(authoritative, current, preserveConcurrentHead);
    const ordinalSourceRows = authoritativeDisconnected ? [] : currentRows;
    const authoritativeOrdinals = projectAuthoritativeTurnOrdinals(ordinalSourceRows, thread.turns.map((turn) => turn.id));
    const nextRows = rowsForThread(connectionId, thread, sessionId, openedAt, authoritativeOrdinals, historyEpoch);
    const prefix = threadRowPrefix(connectionId, thread.id);
    controls.begin({ immediate: true });
    let mutationCount = 0;
    if (mode === "authoritative") {
      // A bounded refresh adds/reconciles the hot tail. Older sealed history
      // stays resident and is never rewritten or discarded just because it is
      // outside the server's latest page. Only an abandoned mutable head is
      // removed when the authoritative page no longer contains it.
      for (const row of source.rowsForThread(connectionId, thread.id)) {
        const key = row.id;
        if (!key.startsWith(prefix) || row.kind !== "turn" || row.sealed || nextRows.has(key)) continue;
        source.delete(key);
        controls.write({ type: "delete", key });
        mutationCount += 1;
        if (row.remoteTurnId === null) continue;
        if (deleteRow(source, controls, turnMetaKey(connectionId, thread.id, row.remoteTurnId))) mutationCount += 1;
        if (deleteRow(source, controls, activityKey(connectionId, thread.id, row.remoteTurnId))) mutationCount += 1;
      }
    }
    for (const [key, row] of nextRows) {
      const previous = source.get(key);
      const reconciled = reconcileAuthoritativeThreadDetailRow(previous, row);
      // Completed turn content is append-only. Late token/cost/diff changes go
      // to turnMeta and never invalidate the large history row.
      if (!shouldWriteAuthoritativeThreadDetailRow(previous, reconciled)) continue;
      if (writeOwnedRow(controls, key, reconciled)) mutationCount += 1;
    }
    // Activity and metadata are stored separately from immutable turn content.
    // Keep their keyset position aligned when an overlapping authoritative
    // page repairs a turn ordinal.
    for (const [turnId, ordinal] of authoritativeOrdinals) {
      for (const key of [turnMetaKey(connectionId, thread.id, turnId), activityKey(connectionId, thread.id, turnId)]) {
        const previous = source.get(key);
        if (previous === undefined || (previous.ordinal === ordinal && previous.historyEpoch === historyEpoch)) continue;
        if (writeOwnedRow(controls, key, { ...previous, ordinal, historyEpoch })) mutationCount += 1;
      }
    }
    if (mutationCount === 0) await controls.commit();
    else await controls.commit({ durable: true });
  };

  const publishLiveSlice = (connectionId: string, thread: Thread, durable: boolean): Promise<void> => {
    if (disposed) return Promise.resolve();
    const controls = ensureControls();
    const metaKey = threadMetaKey(connectionId, thread.id);
    const previousMeta = source.get(metaKey);
    if (previousMeta?.kind !== "thread") return Promise.resolve();
    const historyEpoch = previousMeta.historyEpoch;
    let nextOrdinal = (source.ordinalBounds(connectionId, thread.id, historyEpoch)?.max ?? -1) + 1;
    controls.begin({ immediate: true });
    let mutationCount = writeOwnedRow(controls, metaKey, threadRow(
      connectionId,
      thread,
      previousMeta.sessionId,
      previousMeta.lastOpenedAt,
      historyEpoch,
    )) ? 1 : 0;
    for (const rawTurn of thread.turns) {
      const turn = compactCompletedTurnForStorage(rawTurn);
      const key = turnStorageKey(connectionId, thread.id, turn);
      const previousKey = source.turnRowKey(connectionId, thread.id, turn.id);
      const previous = previousKey === null ? undefined : source.get(previousKey);
      const currentByKey = source.get(key);
      const ordinal = reusableTurnOrdinal(previous, historyEpoch)
        ?? reusableTurnOrdinal(currentByKey, historyEpoch)
        ?? nextOrdinal++;
      if (previousKey !== null && previousKey !== key) {
        source.delete(previousKey);
        controls.write({ type: "delete", key: previousKey });
        mutationCount += 1;
      }
      const content = turnRow(connectionId, thread.id, turn, ordinal, historyEpoch);
      if (shouldWriteThreadDetailRow(source.get(key), content) && writeOwnedRow(controls, key, content)) mutationCount += 1;
      const metadata = projectedTurnMetadata(turn);
      if (metadata !== null) {
        const metadataRow = turnMetaRow(connectionId, thread.id, turn.id, metadata, ordinal, turn.status !== "inProgress", historyEpoch);
        if (writeOwnedRow(controls, metadataRow.id, metadataRow)) mutationCount += 1;
      }
    }
    if (mutationCount === 0) {
      void controls.commit();
      return Promise.resolve();
    }
    return controls.commit({ durable });
  };

  const loadWindow = async (request: ThreadChatWindowRequest, navigationToken?: number): Promise<void> => {
    if (navigationToken !== undefined && !windowIntents.isCurrent(navigationToken)) return;
    const generation = chat.startWindow(request);
    try {
      await writes.run(async () => {
        // Superseded press intents that have not reached SQLite are skipped
        // instead of making the selected destination wait behind useless work.
        if (navigationToken !== undefined && !windowIntents.isCurrent(navigationToken)) return;
        const loaded = await detailStorage.loadResolvedWindow({
          ...request,
          restoreNewerBuffer: Math.floor(request.residentTurnLimit / 2),
        });
        // The installed SQLite API cannot interrupt a statement already in
        // flight. Drop its projection as soon as it returns, before it can
        // replace rows or extend the queue's useful critical section.
        if (navigationToken !== undefined && !windowIntents.isCurrent(navigationToken)) return;
        const persistedRows = [
          ...loaded.turnRows,
          ...loaded.detailRows,
          ...loaded.liveRows,
        ];
        // Optimistic composer mutations are synchronous and may land while
        // this SQLite snapshot is in flight. Overlay both rows and tombstones
        // before deriving membership so the atomic install cannot hide or
        // resurrect them.
        const rows = mergePendingTimelineOverlays(
          persistedRows,
          [...stagedPendingOverlays.values()],
          request.connectionId,
          request.threadId,
        );
        const liveRowIds = rows.flatMap((row) => !row.sealed
          && (row.kind === "pending" || row.historyEpoch === loaded.historyEpoch)
          ? [row.id]
          : []);
        const committed = chat.commitWindow(request, generation, {
          scope: threadChatScope(request.connectionId, request.threadId),
          requestKey: threadChatRequestKey(request),
          historyEpoch: loaded.historyEpoch,
          latestSealedOrdinal: loaded.latestSealedOrdinal,
          earliestSealedOrdinal: loaded.earliestSealedOrdinal,
          requestedMaxOrdinal: loaded.requestedMaxOrdinal,
          residentTurnLimit: request.residentTurnLimit,
          turnRowIds: loaded.turnRows.map(({ id }) => id),
          detailRowIds: loaded.detailRows.map(({ id }) => id),
          liveRowIds,
          rows,
        });
        if (!committed) return;
        source.replaceThreadLoaded(request.connectionId, request.threadId, rows);
      });
    } catch (cause) {
      if (navigationToken !== undefined && !windowIntents.isCurrent(navigationToken)) return;
      chat.failWindow(request, generation, cause);
      throw cause;
    }
  };

  const database: ThreadDetailDatabase = {
    sessionId,
    chat,
    async prepare() {
      await detailStorage.prepare();
      // One tiny cursor row per changed thread makes unloaded detail changes
      // durable without hydrating the full conversation history into Hermes.
      await invalidations.preload();
    },
    windowResource(request) {
      return chat.resource(request, async () => await database.loadWindow(request));
    },
    preloadWindow(request) {
      const scope = threadChatScope(request.connectionId, request.threadId);
      const lease = windowIntents.begin(
        scope,
        threadChatRequestKey(request) as string,
        () => chat.retainWindow(request.connectionId, request.threadId),
      );
      const resource = chat.resource(request, async () => await loadWindow(request, lease.token));
      void Promise.resolve(resource.ready$.peek()).catch(() => undefined);
      return () => windowIntents.cancel(lease);
    },
    retainWindow(connectionId, threadId) {
      const release = chat.retainWindow(connectionId, threadId);
      windowIntents.adopt(threadChatScope(connectionId, threadId));
      return release;
    },
    adoptPreloadedWindow(connectionId, threadId) {
      windowIntents.adopt(threadChatScope(connectionId, threadId));
    },
    async loadWindow(request) {
      await loadWindow(request);
    },
    readWindowRows(snapshot) {
      return {
        turnRows: chat.readRows(snapshot.turnRowIds),
        detailRows: chat.readRows(snapshot.detailRowIds),
        liveRows: chat.readRows(snapshot.liveRowIds),
      };
    },
    async applySnapshot(connectionId, snapshots) {
      await writes.run(async () => {
        if (disposed) return;
        const controls = ensureControls();
        const byId = new Map(snapshots.map((snapshot) => [snapshot.thread.id, snapshot]));
        controls.begin({ immediate: true });
        let mutationCount = 0;
        for (const row of source.threadMetaRows(connectionId)) {
          const snapshot = byId.get(row.remoteThreadId);
          if (snapshot === undefined || row.thread === null) continue;
          // Snapshot list updates only bounded thread metadata. Turn metadata is
          // stored in independent rows and must not force a history scan here.
          const metadata = preserveProjectedTurnMetadata(snapshot.thread, row.thread);
          const next = threadRow(connectionId, metadata, row.sessionId, row.lastOpenedAt, row.historyEpoch);
          if (writeOwnedRow(controls, next.id, next)) mutationCount += 1;
        }
        if (mutationCount === 0) await controls.commit();
        else await controls.commit({ durable: true });
      });
    },
    async applyEvents(connectionId, events) {
      const startedThreadIds = new Set(events.flatMap((event) => {
        const threadId = threadIdFromEvent(event.payload);
        return threadId !== null && startedThreadShells.has(threadScope(connectionId, threadId))
          ? [threadId]
          : [];
      }));
      return await writes.run(async () => {
        if (disposed || events.length === 0) {
          return { checkpoint: Promise.resolve(), threads: new Map() };
        }
        const durable = events.some((event) => DURABLE_LIVE_BOUNDARIES.has(String(event.payload.method ?? "")));
        const checkpoints: Promise<void>[] = [persistInvalidations(invalidations, connectionId, events)];
        const projectedThreads = new Map<string, { before: Thread; after: Thread }>();
        const hasLoadedThread = events.some((event) => {
          const threadId = threadIdFromEvent(event.payload);
          return threadId !== null && source.has(threadMetaKey(connectionId, threadId));
        });
        if (!hasLoadedThread && startedThreadIds.size === 0) {
          return { checkpoint: Promise.all(checkpoints).then(() => undefined), threads: projectedThreads };
        }
        // A loaded/new thread is a live UI projection. Never silently ACK it
        // as an invalidation when the active Legend range already owns the
        // thread: restart the writer synchronously or fail the batch so
        // the native durable stream retries it.
        const controls = ensureControls();
        for (const threadId of startedThreadIds) {
          if (source.has(threadMetaKey(connectionId, threadId))) continue;
          const shell = startedThreadShells.get(threadScope(connectionId, threadId));
          if (shell !== undefined) await publishThread(connectionId, shell, "live");
        }
        const byThread = new Map<string, Record<string, unknown>[]>();
        for (const event of events) {
          const threadId = threadIdFromEvent(event.payload);
          if (threadId === null || !source.has(threadMetaKey(connectionId, threadId))) continue;
          const patch = threadProjectionPatchFromEvent(event.payload) ?? legacyThreadProjectionPatch(event.payload);
          if (patch?.operation.kind === "threadDeleted") {
            await deleteThreadRows(source, controls, connectionId, threadId);
            continue;
          }
          const payloads = byThread.get(threadId) ?? [];
          payloads.push(event.payload);
          byThread.set(threadId, payloads);
        }
        for (const [threadId, payloads] of byThread) {
          const patches = payloads
            .map((payload) => threadProjectionPatchFromEvent(payload) ?? legacyThreadProjectionPatch(payload))
            .filter((patch) => patch !== null);
          const slice = source.liveRows(connectionId, threadId, patches);
          const current = materializeThreadDetail(slice, connectionId, threadId, sessionId);
          if (current === null) continue;
          const next = applyThreadProjectionPatchesImmutable(current.thread, patches);
          projectedThreads.set(threadId, { before: current.thread, after: next });
          if (next !== current.thread) checkpoints.push(publishLiveSlice(connectionId, next, durable));
        }
        for (const event of events) {
          const threadId = threadIdFromEvent(event.payload);
          if (threadId === null) continue;
          const method = String(event.payload.method ?? "");
          if (method === "turn/completed" || method === "thread/deleted") {
            startedThreadShells.delete(threadScope(connectionId, threadId));
          }
        }
        return {
          checkpoint: Promise.all(checkpoints).then(() => undefined),
          threads: projectedThreads,
        };
      });
    },
    captureRefreshCursor(connectionId, threadId) {
      return invalidations.get(invalidationKey(connectionId, threadId))?.cursor ?? 0;
    },
    async replaceThread(connectionId, thread, cleanThroughCursor = null) {
      if (thread.turns.length === 0) {
        const key = threadScope(connectionId, thread.id);
        startedThreadShells.delete(key);
        startedThreadShells.set(key, thread);
        while (startedThreadShells.size > 32) {
          const oldest = startedThreadShells.keys().next().value as string | undefined;
          if (oldest === undefined) break;
          startedThreadShells.delete(oldest);
        }
      }
      await writes.run(async () => {
        const latestCursor = invalidations.get(invalidationKey(connectionId, thread.id))?.cursor ?? 0;
        const preserveConcurrentHead = cleanThroughCursor !== null && latestCursor > cleanThroughCursor;
        await publishThread(connectionId, thread, "authoritative", Date.now(), preserveConcurrentHead);
        if (cleanThroughCursor !== null) {
          await clearInvalidationThrough(invalidations, connectionId, thread.id, cleanThroughCursor);
        }
      });
    },
    async prependTurns(connectionId, threadId, expectedHistoryEpoch, turns) {
      return await writes.run(async () => {
        // The source owns every row in the resident range. Rebuilding it from
        // every durable row here made successive history pages O(n²): page 20
        // rescanned all 19 preceding pages before inserting twelve rows.
        const historyEpoch = source.historyEpoch(connectionId, threadId);
        if (historyEpoch !== expectedHistoryEpoch) return { accepted: false, historyEpoch, extendedMinimum: false };
        if (turns.length === 0) return { accepted: true, historyEpoch, extendedMinimum: false };
        if (disposed) throw new Error("Thread detail database is closed");
        for (const row of await loadDurablePrependRows(connectionId, threadId, historyEpoch, turns.map((turn) => turn.id))) {
          source.set(row.id, row);
        }
        const controls = ensureControls();
        const previousMinimum = source.ordinalBounds(connectionId, threadId, historyEpoch)?.min ?? null;
        const prependedOrdinals = projectPrependedTurnOrdinals(
          source.rowsForThread(connectionId, threadId),
          historyEpoch,
          turns.map((turn) => turn.id),
        );
        let mutationCount = 0;
        controls.begin({ immediate: true });
        for (const turn of turns) {
          const previousKey = source.turnRowKey(connectionId, threadId, turn.id);
          const key = turnStorageKey(connectionId, threadId, turn);
          const previous = previousKey === null ? source.get(key) : source.get(previousKey);
          const ordinal = prependedOrdinals.get(turn.id)!;
          const incoming = turnRow(connectionId, threadId, turn, ordinal, historyEpoch);
          const content = reconcileAuthoritativeThreadDetailRow(previous, incoming);
          if (previousKey !== null && previousKey !== key) {
            source.delete(previousKey);
            controls.write({ type: "delete", key: previousKey });
            mutationCount += 1;
          }
          // Cursor pages may overlap a previously persisted completion event.
          // Reconcile those rows as well: the summary is what supplies a final
          // agent answer to an earlier user-only sealed row.
          if (shouldWriteAuthoritativeThreadDetailRow(previous, content) && writeOwnedRow(controls, content.id, content)) mutationCount += 1;
          const metadata = projectedTurnMetadata(turn);
          if (metadata !== null) {
            const row = turnMetaRow(connectionId, threadId, turn.id, metadata, ordinal, turn.status !== "inProgress", historyEpoch);
            if (writeOwnedRow(controls, row.id, row)) mutationCount += 1;
          }
          // A cursor page can reconnect a turn that was retained in an older,
          // disconnected history epoch. Its lazy overlays must migrate with
          // the turn or the current window would silently lose activity and
          // completion metadata for that row.
          for (const overlayKey of [turnMetaKey(connectionId, threadId, turn.id), activityKey(connectionId, threadId, turn.id)]) {
            const overlay = source.get(overlayKey);
            if (overlay === undefined || (overlay.historyEpoch === historyEpoch && overlay.ordinal === ordinal)) continue;
            if (writeOwnedRow(controls, overlayKey, { ...overlay, historyEpoch, ordinal })) mutationCount += 1;
          }
        }
        if (mutationCount === 0) await controls.commit();
        else await controls.commit({ durable: true });
        const nextMinimum = source.ordinalBounds(connectionId, threadId, historyEpoch)?.min ?? null;
        return {
          accepted: true,
          historyEpoch,
          extendedMinimum: nextMinimum !== null && (previousMinimum === null || nextMinimum < previousMinimum),
        };
      });
    },
    async replaceTurnItems(connectionId, threadId, turnId, items) {
      await writes.run(async () => {
        // Activity hydration addresses one already loaded turn. Never scan the
        // full retained history just to attach its lazily fetched tool output.
        if (disposed) return;
        const contentKey = source.turnRowKey(connectionId, threadId, turnId);
        const turnContent = contentKey === null ? undefined : source.get(contentKey);
        if (turnContent?.turn === null || turnContent?.turn === undefined) return;
        const row = activityRow(connectionId, threadId, turnId, turnContent.ordinal, items, turnContent.historyEpoch);
        if (!shouldWriteHydratedActivityRow(source.get(row.id), row)) return;
        const controls = ensureControls();
        controls.begin({ immediate: true });
        if (!writeOwnedRow(controls, row.id, row)) {
          await controls.commit();
          return;
        }
        await controls.commit({ durable: true });
      });
    },
    createPending(input) {
      const order = input.order ?? input.createdAt;
      return pendingRow(input.connectionId, input.threadId, { ...input, order });
    },
    stagePendingMutation(mutation) {
      if (closing || disposed) return { rollback() {}, complete() {} };
      const owner = nextStagedPendingOwner++;
      const previous = new Map<string, ThreadDetailRow | undefined>();
      const changes: Array<{ type: "insert" | "update"; value: ThreadDetailRow } | { type: "delete"; key: string }> = [];
      for (const key of mutation.deletes) {
        const row = source.get(key);
        previous.set(key, row);
        if (row?.kind !== "pending") continue;
        source.delete(key);
        stagedPendingOverlays.set(key, {
          owner,
          key,
          connectionId: row.connectionId,
          threadId: row.remoteThreadId,
          row: null,
        });
        changes.push({ type: "delete", key });
      }
      for (const row of mutation.upserts) {
        const current = source.get(row.id);
        previous.set(row.id, current);
        if (current?.kind === "turn") continue;
        const next = current?.kind === "pending" && current.pending !== null && current.pending !== undefined && row.pending !== null && row.pending !== undefined
          ? { ...row, pending: mergePendingTimelineEntry(current.pending, row.pending) }
          : row;
        source.set(next.id, next);
        stagedPendingOverlays.set(next.id, {
          owner,
          key: next.id,
          connectionId: next.connectionId,
          threadId: next.remoteThreadId,
          row: next,
        });
        changes.push({ type: current === undefined ? "insert" : "update", value: next });
      }
      chat.publishChanges(changes);
      const scopes = new Map<string, { connectionId: string; threadId: string }>();
      for (const value of [...previous.values(), ...mutation.upserts]) {
        if (value === undefined) continue;
        scopes.set(threadScope(value.connectionId, value.remoteThreadId), { connectionId: value.connectionId, threadId: value.remoteThreadId });
      }
      for (const { connectionId, threadId } of scopes.values()) chat.refreshThread(connectionId, threadId, source.rowsForThread(connectionId, threadId));
      let active = true;
      return {
        rollback() {
          if (!active) return;
          active = false;
          const rollbackChanges: Array<{ type: "insert" | "update"; value: ThreadDetailRow } | { type: "delete"; key: string }> = [];
          for (const [key, row] of previous) {
            if (stagedPendingOverlays.get(key)?.owner !== owner) continue;
            stagedPendingOverlays.delete(key);
            if (source.get(key)?.kind === "turn") continue;
            if (row === undefined) {
              source.delete(key);
              rollbackChanges.push({ type: "delete", key });
            } else {
              source.set(key, row);
              rollbackChanges.push({ type: "update", value: row });
            }
          }
          chat.publishChanges(rollbackChanges);
          for (const { connectionId, threadId } of scopes.values()) chat.refreshThread(connectionId, threadId, source.rowsForThread(connectionId, threadId));
        },
        complete() {
          if (!active) return;
          active = false;
          for (const key of previous.keys()) {
            if (stagedPendingOverlays.get(key)?.owner === owner) stagedPendingOverlays.delete(key);
          }
        },
      };
    },
    async commitPending(row, options) {
      return await persistPendingRow(row, options?.durable === true);
    },
    async commitPendingMutation(mutation, options) {
      return await persistPendingMutation(mutation, options?.durable === true);
    },
    async applyCommandDelivery(delivery) {
      await applyCommandDelivery(delivery);
    },
    async reconcileNativeCommands(connectionId, threadId, deliveries) {
      if (disposed || !source.has(threadMetaKey(connectionId, threadId))) return;
      const activeCommandIds = new Set(deliveries.flatMap((delivery) => (
        delivery.connectionId === connectionId
          && delivery.threadId === threadId
          && (delivery.method === "turn/start" || delivery.method === "turn/steer")
          ? [delivery.commandId]
          : []
      )));
      for (const delivery of deliveries) {
        if (delivery.connectionId !== connectionId) continue;
        if (delivery.threadId !== threadId && source.pendingRow(connectionId, delivery.targetCommandId ?? "") === undefined) continue;
        await applyCommandDelivery(delivery);
      }
      const cleanup = planPendingDeliveryProjectionCleanup(
        source.rowsForThread(connectionId, threadId),
        activeCommandIds,
      );
      if (cleanup.deletes.length > 0) await persistPendingMutation(cleanup, true);
    },
    async replaceQueued(connectionId, threadId, commands, preserveCommandIds = new Set()) {
      const incoming = new Map(commands
        .filter((command) => command.remoteThreadId === threadId)
        .map((command) => {
          const existing = source.pendingRow(connectionId, command.commandId)?.pending;
          const queuedInput = parseQueuedInput(command.params);
          const entry: PendingTimelineEntry = {
            commandId: command.commandId,
            method: "turn/start",
            presentation: command.presentation,
            workspaceRequestId: command.workspaceRequestId,
            text: queuedInput.text,
            attachments: queuedInput.attachments,
            state: command.state,
            attempts: existing?.attempts ?? 0,
            lastError: command.lastError,
            createdAt: command.createdAt,
            updatedAt: Date.now(),
            order: command.order,
          };
          return [command.commandId, pendingRow(connectionId, threadId, entry)] as const;
        }));
      await writes.run(async () => {
        if (disposed) return;
        const controls = ensureControls();
        controls.begin({ immediate: true });
        let changed = false;
        for (const row of source.rowsForThread(connectionId, threadId)) {
          if (row.kind !== "pending" || row.pending?.presentation !== "queue") continue;
          if (incoming.has(row.pending.commandId) || preserveCommandIds.has(row.pending.commandId)) continue;
          source.delete(row.id);
          controls.write({ type: "delete", key: row.id });
          changed = true;
        }
        for (const row of incoming.values()) {
          const incomingEntry = row.pending;
          if (incomingEntry === null || incomingEntry === undefined) continue;
          const previous = source.get(row.id);
          if (previous?.kind === "turn") continue;
          const next = previous?.kind === "pending" && previous.pending !== null && previous.pending !== undefined
            ? { ...row, pending: mergePendingTimelineEntry(previous.pending, incomingEntry) }
            : row;
          if (writeOwnedRow(controls, next.id, next)) changed = true;
        }
        if (!changed) await controls.commit();
        else await controls.commit({ durable: true });
      });
    },
    hasPendingDelivery(connectionId, threadId, commandId) {
      const row = source.pendingRow(connectionId, commandId);
      return row?.remoteThreadId === threadId
        && row.kind === "pending"
        && row.pending?.presentation === "delivery";
    },
    listQueued(connectionId, threadId) {
      return source.rowsForThread(connectionId, threadId)
        .flatMap((row) => row.kind === "pending" && row.pending?.presentation === "queue" ? [row.pending] : [])
        .sort((left, right) => left.order - right.order || left.createdAt - right.createdAt);
    },
    planQueuedEdit(connectionId, commandId, text, attachments) {
      return planQueuedEditMutation(source.pendingRow(connectionId, commandId), text, attachments);
    },
    planQueuedRemoval(connectionId, commandId) {
      return planQueuedRemovalMutation(source.pendingRow(connectionId, commandId));
    },
    planQueuedMove(connectionId, threadId, commandId, direction) {
      return planQueuedMoveMutation(source.rowsForThread(connectionId, threadId), commandId, direction);
    },
    getThread(connectionId, threadId) {
      return materializeThreadDetail(source.rowsForThread(connectionId, threadId), connectionId, threadId, sessionId)?.thread ?? null;
    },
    close() {
      if (closePromise !== null) return closePromise;
      closing = true;
      windowIntents.close();
      const drain = writes.close();
      closePromise = (async () => {
        try {
          // Tasks accepted before closing still see disposed=false and cross
          // their durable boundary before SQLite is flushed and closed.
          await drain;
          disposed = true;
          await detailStorage.close();
        } finally {
          disposed = true;
          unregisterDetailFlusher();
          stagedPendingOverlays.clear();
          chat.close();
          invalidationModel.close();
        }
      })();
      return closePromise;
    },
  };
  return database;
}

async function persistInvalidations(
  collection: Collection<ThreadInvalidationRow, string>,
  connectionId: string,
  events: SyncEvent[],
): Promise<void> {
  const latest = latestThreadInvalidations(events);
  const checkpoints: Promise<void>[] = [];
  for (const [threadId, cursor] of latest) {
    const id = invalidationKey(connectionId, threadId);
    const current = collection.get(id);
    if (current !== undefined && current.cursor >= cursor) continue;
    const transaction = current === undefined
      ? collection.insert({ id, connectionId, threadId, cursor })
      : collection.update(id, (draft) => { draft.cursor = cursor; });
    checkpoints.push(transaction.isPersisted.promise.then(() => undefined));
  }
  await Promise.all(checkpoints);
}

async function clearInvalidationThrough(
  collection: Collection<ThreadInvalidationRow, string>,
  connectionId: string,
  threadId: string,
  cursor: number,
): Promise<void> {
  const id = invalidationKey(connectionId, threadId);
  const current = collection.get(id);
  if (current === undefined || !invalidationCanBeCleared(current.cursor, cursor)) return;
  const transaction = collection.delete(id);
  await transaction.isPersisted.promise;
}

function invalidationKey(connectionId: string, threadId: string): string {
  return `${connectionId}\u0000${threadId}`;
}

function rowsForThread(
  connectionId: string,
  thread: Thread,
  sessionId: string,
  lastOpenedAt: number,
  turnOrdinals?: ReadonlyMap<string, number>,
  historyEpoch = 0,
): Map<string, ThreadDetailRow> {
  const result = new Map<string, ThreadDetailRow>();
  const meta = threadRow(connectionId, thread, sessionId, lastOpenedAt, historyEpoch);
  result.set(meta.id, meta);
  thread.turns.forEach((turn, index) => {
    const ordinal = turnOrdinals?.get(turn.id) ?? index;
    const content = turnRow(connectionId, thread.id, turn, ordinal, historyEpoch);
    result.set(content.id, content);
    const metadata = projectedTurnMetadata(turn);
    if (metadata !== null) {
      const row = turnMetaRow(connectionId, thread.id, turn.id, metadata, ordinal, turn.status !== "inProgress", historyEpoch);
      result.set(row.id, row);
    }
  });
  return result;
}

function baseRow(
  id: string,
  kind: ThreadDetailRow["kind"],
  connectionId: string,
  threadId: string,
  turnId: string | null,
  historyEpoch: number,
  ordinal: number,
  sessionId: string | null,
  lastOpenedAt: number,
): ThreadDetailRow {
  return {
    id,
    kind,
    connectionId,
    remoteThreadId: threadId,
    remoteTurnId: turnId,
    historyEpoch,
    ordinal,
    sessionId,
    lastOpenedAt,
    sealed: false,
    thread: null,
    turn: null,
    turnMetadata: null,
    activityItems: null,
    pending: null,
  };
}

function threadRow(connectionId: string, thread: Thread, sessionId: string | null, lastOpenedAt: number, historyEpoch: number): ThreadDetailRow {
  return {
    ...baseRow(threadMetaKey(connectionId, thread.id), "thread", connectionId, thread.id, null, historyEpoch, -1, sessionId, lastOpenedAt),
    thread: stripThreadTurns(thread),
  };
}

function turnRow(connectionId: string, threadId: string, turn: Turn, ordinal: number, historyEpoch: number): ThreadDetailRow {
  return {
    ...baseRow(turnStorageKey(connectionId, threadId, turn), "turn", connectionId, threadId, turn.id, historyEpoch, ordinal, null, 0),
    sealed: turn.status !== "inProgress",
    turn: stripTurnMetadata(turn),
  };
}

function turnMetaRow(
  connectionId: string,
  threadId: string,
  turnId: string,
  metadata: ProjectedTurnMetadata,
  ordinal: number,
  sealed: boolean,
  historyEpoch: number,
): ThreadDetailRow {
  return {
    ...baseRow(turnMetaKey(connectionId, threadId, turnId), "turnMeta", connectionId, threadId, turnId, historyEpoch, ordinal, null, 0),
    sealed,
    turnMetadata: structuredClone(metadata),
  };
}

function activityRow(connectionId: string, threadId: string, turnId: string, ordinal: number, items: Turn["items"], historyEpoch: number): ThreadDetailRow {
  return {
    ...baseRow(activityKey(connectionId, threadId, turnId), "activity", connectionId, threadId, turnId, historyEpoch, ordinal, null, 0),
    sealed: true,
    activityItems: structuredClone(items),
  };
}

function pendingRow(connectionId: string, threadId: string, entry: PendingTimelineEntry, historyEpoch = 0): ThreadDetailRow {
  return {
    ...baseRow(pendingTimelineRowId(connectionId, threadId, entry.commandId), "pending", connectionId, threadId, null, historyEpoch, entry.order, null, 0),
    pending: entry,
  };
}

function stripThreadTurns(thread: Thread): Thread {
  return { ...thread, turns: [] };
}

function stripTurnMetadata(turn: Turn): Turn {
  const augmented = turn as Turn & { codewide?: ProjectedTurnMetadata };
  if (augmented.codewide === undefined) return turn;
  const clone = { ...augmented };
  delete clone.codewide;
  return clone;
}

function writeRow(source: Map<string, ThreadDetailRow>, controls: SyncControls, key: string, row: ThreadDetailRow): boolean {
  const previous = source.get(key);
  if (previous !== undefined && sameThreadDetailRow(previous, row)) return false;
  source.set(key, row);
  controls.write({ type: previous === undefined ? "insert" : "update", value: row });
  return true;
}

function sameThreadDetailRow(previous: ThreadDetailRow, next: ThreadDetailRow): boolean {
  if (
    previous.kind !== next.kind
    || previous.id !== next.id
    || previous.historyEpoch !== next.historyEpoch
    || previous.ordinal !== next.ordinal
    || previous.sessionId !== next.sessionId
    || previous.lastOpenedAt !== next.lastOpenedAt
    || previous.sealed !== next.sealed
  ) return false;
  if (next.kind === "turn") {
    // Event reduction preserves references for untouched turns. Never stringify
    // the growing active turn: doing that for every delta makes streaming O(n²).
    return previous.turn === next.turn;
  }
  if (next.kind === "pending") {
    return previous.kind === "pending"
      && previous.pending !== null
      && previous.pending !== undefined
      && next.pending !== null
      && next.pending !== undefined
      && samePendingTimelineEntry(previous.pending, next.pending);
  }
  if (next.kind === "activity") return previous.activityItems === next.activityItems;
  if (next.kind === "turnMeta") {
    return JSON.stringify(previous.turnMetadata) === JSON.stringify(next.turnMetadata);
  }
  // Thread metadata is bounded because turns were split into independent rows.
  return JSON.stringify(previous.thread) === JSON.stringify(next.thread);
}

function deleteRow(source: Map<string, ThreadDetailRow>, controls: SyncControls, key: string): boolean {
  if (!source.delete(key)) return false;
  controls.write({ type: "delete", key });
  return true;
}

async function deleteThreadRows(source: ThreadDetailSource, controls: SyncControls, connectionId: string, threadId: string): Promise<void> {
  controls.begin({ immediate: true });
  let mutationCount = 0;
  // Deleting one thread must not scan every hydrated row from every server.
  for (const row of source.rowsForThread(connectionId, threadId)) {
    source.delete(row.id);
    controls.write({ type: "delete", key: row.id });
    mutationCount += 1;
  }
  if (mutationCount === 0) await controls.commit();
  else await controls.commit({ durable: true });
}

function threadMetaKey(connectionId: string, threadId: string): string {
  return `${threadRowPrefix(connectionId, threadId)}thread`;
}

function turnStorageKey(connectionId: string, threadId: string, turn: Turn): string {
  return authoritativeTimelineRowId(connectionId, threadId, turn);
}

function turnMetaKey(connectionId: string, threadId: string, turnId: string): string {
  return `${threadRowPrefix(connectionId, threadId)}turnMeta\u0000${turnId}`;
}

function activityKey(connectionId: string, threadId: string, turnId: string): string {
  return `${threadRowPrefix(connectionId, threadId)}activity\u0000${turnId}`;
}

function threadRowPrefix(connectionId: string, threadId: string): string {
  return `${connectionId}\u0000${threadId}\u0000`;
}

function threadScope(connectionId: string, threadId: string): string {
  return `${connectionId}\u0000${threadId}`;
}

function threadEpochScope(connectionId: string, threadId: string, historyEpoch: number): string {
  return `${threadScope(connectionId, threadId)}\u0000${historyEpoch}`;
}

function pendingCommandScope(connectionId: string, commandId: string): string {
  return `${connectionId}\u0000${commandId}`;
}

function samePendingTimelineEntry(left: PendingTimelineEntry, right: PendingTimelineEntry): boolean {
  return left.commandId === right.commandId
    && left.method === right.method
    && left.presentation === right.presentation
    && left.workspaceRequestId === right.workspaceRequestId
    && left.text === right.text
    && JSON.stringify(left.attachments) === JSON.stringify(right.attachments)
    && left.state === right.state
    && left.attempts === right.attempts
    && left.lastError === right.lastError
    && left.createdAt === right.createdAt
    && left.updatedAt === right.updatedAt
    && left.order === right.order;
}
