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
import { BasicIndex, createCollection, type Collection } from "@tanstack/react-db";
import { persistedCollectionOptions } from "@tanstack/react-native-db-sqlite-persistence";

import {
  commitUiCacheMutationCheckpointed,
  commitUiCacheSyncCheckpointed,
  commitUiCacheSyncDurably,
  getUiCachePersistence,
} from "./ui-cache-persistence.native";
import {
  compactCompletedTurnForStorage,
  authoritativeTimelineRowId,
  materializeThreadDetail,
  mergePendingTimelineEntry,
  reconcileAuthoritativeThreadDetailRow,
  reconcileAuthoritativeThread,
  shouldWriteAuthoritativeThreadDetailRow,
  shouldWriteHydratedActivityRow,
  shouldWriteThreadDetailRow,
  pendingTimelineRowId,
  planQueuedEditMutation,
  planQueuedMoveMutation,
  planQueuedRemovalMutation,
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
import { createSyncControlLease } from "./sync-control-lease";

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
  collection: Collection<ThreadDetailRow, string>;
  prepare(): Promise<void>;
  applySnapshot(connectionId: string, threads: SyncSnapshotThread[], cursor: number): Promise<void>;
  applyEvents(connectionId: string, events: SyncEvent[]): Promise<ThreadEventProjection>;
  captureRefreshCursor(connectionId: string, threadId: string): number;
  replaceThread(connectionId: string, thread: Thread, cleanThroughCursor?: number | null): Promise<void>;
  prependTurns(connectionId: string, threadId: string, turns: Turn[]): Promise<void>;
  replaceTurnItems(connectionId: string, threadId: string, turnId: string, items: Turn["items"]): Promise<void>;
  createPending(input: PendingTimelineInput): ThreadDetailRow;
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
  close(): void;
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

type SyncControls = {
  begin(options?: { immediate?: boolean }): void;
  write(change:
    | { type: "insert" | "update"; value: ThreadDetailRow }
    | { type: "delete"; key: string }
  ): void;
  commit(): void;
};

type OrdinalBounds = { min: number; max: number; dirty: boolean };

/**
 * Incremental index over the rows TanStack has actually hydrated. History can
 * grow to thousands of turns, so a live delta must never rebuild or scan the
 * whole collection just to find the mutable head.
 */
class ThreadDetailSource extends Map<string, ThreadDetailRow> {
  private readonly rowKeysByThread = new Map<string, Set<string>>();
  private readonly threadMetaKeysByConnection = new Map<string, Set<string>>();
  private readonly mutableTurnIdsByThread = new Map<string, Set<string>>();
  private readonly turnOrdinalsByThread = new Map<string, Map<string, number>>();
  private readonly turnRowKeysByRemoteId = new Map<string, Map<string, string>>();
  private readonly pendingRowKeysByCommandId = new Map<string, string>();
  private readonly ordinalBoundsByThread = new Map<string, OrdinalBounds>();

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
    this.mutableTurnIdsByThread.clear();
    this.turnOrdinalsByThread.clear();
    this.turnRowKeysByRemoteId.clear();
    this.pendingRowKeysByCommandId.clear();
    this.ordinalBoundsByThread.clear();
  }

  replaceLoaded(rows: readonly ThreadDetailRow[]): void {
    this.clear();
    for (const row of rows) this.set(row.id, row);
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

  threadMetaRows(connectionId: string): ThreadDetailRow[] {
    const rows: ThreadDetailRow[] = [];
    for (const key of this.threadMetaKeysByConnection.get(connectionId) ?? []) {
      const row = super.get(key);
      if (row !== undefined) rows.push(row);
    }
    return rows;
  }

  liveRows(connectionId: string, threadId: string, patches: ThreadProjectionPatchV1[]): ThreadDetailRow[] {
    const selectedTurnIds = new Set(this.mutableTurnIdsByThread.get(threadScope(connectionId, threadId)) ?? []);
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
        if (row !== undefined) rows.push(row);
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

  ordinalBounds(connectionId: string, threadId: string): { min: number; max: number } | null {
    const scope = threadScope(connectionId, threadId);
    const ordinals = this.turnOrdinalsByThread.get(scope);
    if (ordinals === undefined || ordinals.size === 0) return null;
    let bounds = this.ordinalBoundsByThread.get(scope);
    if (bounds === undefined || bounds.dirty) {
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (const ordinal of ordinals.values()) {
        min = Math.min(min, ordinal);
        max = Math.max(max, ordinal);
      }
      bounds = { min, max, dirty: false };
      this.ordinalBoundsByThread.set(scope, bounds);
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
    const ordinals = this.turnOrdinalsByThread.get(scope) ?? new Map<string, number>();
    ordinals.set(row.remoteTurnId, row.ordinal);
    this.turnOrdinalsByThread.set(scope, ordinals);
    const bounds = this.ordinalBoundsByThread.get(scope);
    if (bounds === undefined) this.ordinalBoundsByThread.set(scope, { min: row.ordinal, max: row.ordinal, dirty: false });
    else if (!bounds.dirty) {
      bounds.min = Math.min(bounds.min, row.ordinal);
      bounds.max = Math.max(bounds.max, row.ordinal);
    }
    const mutable = this.mutableTurnIdsByThread.get(scope) ?? new Set<string>();
    if (row.sealed) mutable.delete(row.remoteTurnId);
    else mutable.add(row.remoteTurnId);
    if (mutable.size === 0) this.mutableTurnIdsByThread.delete(scope);
    else this.mutableTurnIdsByThread.set(scope, mutable);
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
    const ordinals = this.turnOrdinalsByThread.get(scope);
    ordinals?.delete(row.remoteTurnId);
    if (ordinals?.size === 0) this.turnOrdinalsByThread.delete(scope);
    const bounds = this.ordinalBoundsByThread.get(scope);
    if (bounds !== undefined && (row.ordinal === bounds.min || row.ordinal === bounds.max)) bounds.dirty = true;
    const mutable = this.mutableTurnIdsByThread.get(scope);
    mutable?.delete(row.remoteTurnId);
    if (mutable?.size === 0) this.mutableTurnIdsByThread.delete(scope);
  }
}

export function createThreadDetailDatabase(): ThreadDetailDatabase {
  const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const controlLease = createSyncControlLease<SyncControls>();
  const source = new ThreadDetailSource();
  // A new thread can receive its first turn before React switches from the
  // synthetic New Chat scope to the real thread query. Keep only a bounded
  // set of those empty shells so their live events can restart the on-demand
  // controller instead of being reduced to an invalidation that appears only
  // after reopening the conversation.
  const startedThreadShells = new Map<string, Thread>();
  let disposed = false;
  const writes = new SerialTaskQueue();

  const collection = createCollection(
    persistedCollectionOptions<ThreadDetailRow, string>({
      id: THREAD_DETAIL_COLLECTION_ID,
      // v4 resets every pre-bounded-projection row. Older caches may contain
      // giant stdout, diffs or tool results even if their images were clean.
      // v6 gives activity overlays the turn ordinal so bounded resident
      // windows can hydrate the correct tool rows without a full-history scan.
      // Pending rows are additive and old remote-id turn keys are migrated in
      // place as those turns change. Keep v6 so a structural UI-state change
      // never discards already-cached conversation history.
      schemaVersion: 6,
      getKey: (row) => row.id,
      persistence: getUiCachePersistence(),
      // Conversation history is immutable and may be large. Hydrate only the
      // connection/thread subset requested by the active live query instead of
      // copying every cached turn into Hermes during application startup.
      syncMode: "on-demand",
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          const release = controlLease.install({ begin, write, commit });
          markReady();
          return { cleanup: release };
        },
      },
    }),
  );
  // Resident history queries are ordered and bounded by ordinal. Without this
  // index TanStack DB deoptimizes every page into a full collection load,
  // making scroll and streaming progressively slower as history grows.
  collection.createIndex((row) => row.ordinal, { indexType: BasicIndex });
  const invalidations = createCollection(
    persistedCollectionOptions<ThreadInvalidationRow, string>({
      id: THREAD_INVALIDATION_COLLECTION_ID,
      schemaVersion: 1,
      getKey: (row) => row.id,
      persistence: getUiCachePersistence(),
    }),
  );
  // On-demand persistence must not have a global subscription: that would
  // hydrate every thread into Hermes. Re-index only at explicit page/snapshot
  // boundaries; live events then mutate this hot index incrementally.
  const refreshLoadedSource = (): void => source.replaceLoaded(collection.toArray);

  const activeControls = (): SyncControls | null => controlLease.get();

  const ensureControls = (): SyncControls => {
    let controls = activeControls();
    if (controls !== null) return controls;
    // preload() is intentionally a data no-op for on-demand collections and
    // its resolved promise may belong to an older lifecycle. We only need a
    // fresh sync writer here; query-specific subset loading remains lazy.
    collection.startSyncImmediate();
    controls = activeControls();
    if (controls === null) throw new Error("Thread detail database sync controller did not start");
    return controls;
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
      if (previous?.kind !== "pending") continue;
      source.delete(key);
      controls.write({ type: "delete", key });
      changed = true;
    }
    for (const row of mutation.upserts) {
      if (row.kind !== "pending" || row.pending === null || row.pending === undefined) continue;
      const previous = source.get(row.id);
      if (previous?.kind === "turn") continue;
      const next = previous?.kind === "pending" && previous.pending !== null && previous.pending !== undefined
        ? { ...row, pending: mergePendingTimelineEntry(previous.pending, row.pending) }
        : row;
      if (writeRow(source, controls, next.id, next)) changed = true;
    }
    if (!changed || !durable) controls.commit();
    else await commitUiCacheSyncDurably(THREAD_DETAIL_COLLECTION_ID, controls.commit);
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
    refreshLoadedSource();
    const currentSnapshot = materializeThreadDetail(source.rowsForThread(connectionId, incoming.id), connectionId, incoming.id, sessionId);
    const current = currentSnapshot?.thread;
    const authoritative = mode === "authoritative" && currentSnapshot?.fresh === true
      ? preserveProjectedTurnMetadata(incoming, current)
      : incoming;
    const thread = reconcileAuthoritativeThread(authoritative, current, preserveConcurrentHead);
    const nextRows = rowsForThread(connectionId, thread, sessionId, openedAt);
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
      if (writeRow(source, controls, key, reconciled)) mutationCount += 1;
    }
    if (mutationCount === 0) controls.commit();
    else await commitUiCacheSyncDurably(THREAD_DETAIL_COLLECTION_ID, controls.commit);
  };

  const publishLiveSlice = (connectionId: string, thread: Thread, durable: boolean): Promise<void> => {
    if (disposed) return Promise.resolve();
    const controls = ensureControls();
    const metaKey = threadMetaKey(connectionId, thread.id);
    const previousMeta = source.get(metaKey);
    if (previousMeta?.kind !== "thread") return Promise.resolve();
    let nextOrdinal = (source.ordinalBounds(connectionId, thread.id)?.max ?? -1) + 1;
    controls.begin({ immediate: true });
    let mutationCount = writeRow(source, controls, metaKey, threadRow(
      connectionId,
      thread,
      previousMeta.sessionId,
      previousMeta.lastOpenedAt,
    )) ? 1 : 0;
    for (const rawTurn of thread.turns) {
      const turn = compactCompletedTurnForStorage(rawTurn);
      const key = turnStorageKey(connectionId, thread.id, turn);
      const previousKey = source.turnRowKey(connectionId, thread.id, turn.id);
      const previous = previousKey === null ? undefined : source.get(previousKey);
      const ordinal = previous?.ordinal ?? source.get(key)?.ordinal ?? nextOrdinal++;
      if (previousKey !== null && previousKey !== key) {
        source.delete(previousKey);
        controls.write({ type: "delete", key: previousKey });
        mutationCount += 1;
      }
      const content = turnRow(connectionId, thread.id, turn, ordinal);
      if (shouldWriteThreadDetailRow(source.get(key), content) && writeRow(source, controls, key, content)) mutationCount += 1;
      const metadata = projectedTurnMetadata(turn);
      if (metadata !== null) {
        const metadataRow = turnMetaRow(connectionId, thread.id, turn.id, metadata, ordinal, turn.status !== "inProgress");
        if (writeRow(source, controls, metadataRow.id, metadataRow)) mutationCount += 1;
      }
    }
    if (mutationCount === 0) {
      controls.commit();
      return Promise.resolve();
    }
    return durable
      ? commitUiCacheSyncDurably(THREAD_DETAIL_COLLECTION_ID, controls.commit)
      : commitUiCacheSyncCheckpointed(THREAD_DETAIL_COLLECTION_ID, controls.commit);
  };

  return {
    sessionId,
    collection,
    async prepare() {
      // One tiny cursor row per changed thread makes unloaded detail changes
      // durable without hydrating the full conversation history into Hermes.
      await invalidations.preload();
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
          const next = threadRow(connectionId, metadata, row.sessionId, row.lastOpenedAt);
          if (writeRow(source, controls, next.id, next)) mutationCount += 1;
        }
        if (mutationCount === 0) controls.commit();
        else await commitUiCacheSyncDurably(THREAD_DETAIL_COLLECTION_ID, controls.commit);
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
        const checkpoints: Promise<void>[] = [persistInvalidations(invalidations, connectionId, events, durable)];
        const projectedThreads = new Map<string, { before: Thread; after: Thread }>();
        const hasLoadedThread = events.some((event) => {
          const threadId = threadIdFromEvent(event.payload);
          return threadId !== null && source.has(threadMetaKey(connectionId, threadId));
        });
        if (!hasLoadedThread && startedThreadIds.size === 0) {
          return { checkpoint: Promise.all(checkpoints).then(() => undefined), threads: projectedThreads };
        }
        // A loaded/new thread is a live UI projection. Never silently ACK it
        // as an invalidation when TanStack has just recycled the on-demand
        // controller: restart the writer synchronously or fail the batch so
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
    async prependTurns(connectionId, threadId, turns) {
      await writes.run(async () => {
        // The source owns every row written by this runtime. Rebuilding it from
        // collection.toArray here made successive history pages O(n²): page 20
        // rescanned all 19 preceding pages before inserting twelve rows.
        if (turns.length === 0) return;
        if (disposed) throw new Error("Thread detail database is closed");
        const controls = ensureControls();
        const additions = turns.filter((turn) => source.turnRowKey(connectionId, threadId, turn.id) === null);
        const firstOrdinal = (source.ordinalBounds(connectionId, threadId)?.min ?? 0) - additions.length;
        let additionIndex = 0;
        let mutationCount = 0;
        controls.begin({ immediate: true });
        for (const turn of turns) {
          const previousKey = source.turnRowKey(connectionId, threadId, turn.id);
          const key = turnStorageKey(connectionId, threadId, turn);
          const previous = previousKey === null ? source.get(key) : source.get(previousKey);
          const ordinal = previous?.ordinal ?? firstOrdinal + additionIndex++;
          const incoming = turnRow(connectionId, threadId, turn, ordinal);
          const content = reconcileAuthoritativeThreadDetailRow(previous, incoming);
          if (previousKey !== null && previousKey !== key) {
            source.delete(previousKey);
            controls.write({ type: "delete", key: previousKey });
            mutationCount += 1;
          }
          // Cursor pages may overlap a previously persisted completion event.
          // Reconcile those rows as well: the summary is what supplies a final
          // agent answer to an earlier user-only sealed row.
          if (shouldWriteAuthoritativeThreadDetailRow(previous, content) && writeRow(source, controls, content.id, content)) mutationCount += 1;
          const metadata = projectedTurnMetadata(turn);
          if (metadata !== null) {
            const row = turnMetaRow(connectionId, threadId, turn.id, metadata, ordinal, turn.status !== "inProgress");
            if (writeRow(source, controls, row.id, row)) mutationCount += 1;
          }
        }
        if (mutationCount === 0) controls.commit();
        else await commitUiCacheSyncDurably(THREAD_DETAIL_COLLECTION_ID, controls.commit);
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
        const row = activityRow(connectionId, threadId, turnId, turnContent.ordinal, items);
        if (!shouldWriteHydratedActivityRow(source.get(row.id), row)) return;
        const controls = ensureControls();
        controls.begin({ immediate: true });
        if (!writeRow(source, controls, row.id, row)) {
          controls.commit();
          return;
        }
        await commitUiCacheSyncDurably(THREAD_DETAIL_COLLECTION_ID, controls.commit);
      });
    },
    createPending(input) {
      const order = input.order ?? input.createdAt;
      return pendingRow(input.connectionId, input.threadId, { ...input, order });
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
      for (const delivery of deliveries) {
        if (delivery.connectionId !== connectionId) continue;
        if (delivery.threadId !== threadId && source.pendingRow(connectionId, delivery.targetCommandId ?? "") === undefined) continue;
        await applyCommandDelivery(delivery);
      }
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
          if (writeRow(source, controls, next.id, next)) changed = true;
        }
        if (!changed) controls.commit();
        else await commitUiCacheSyncDurably(THREAD_DETAIL_COLLECTION_ID, controls.commit);
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
      refreshLoadedSource();
      return materializeThreadDetail(source.rowsForThread(connectionId, threadId), connectionId, threadId, sessionId)?.thread ?? null;
    },
    close() {
      disposed = true;
      collection.cleanup();
      invalidations.cleanup();
    },
  };
}

async function persistInvalidations(
  collection: Collection<ThreadInvalidationRow, string>,
  connectionId: string,
  events: SyncEvent[],
  durable: boolean,
): Promise<void> {
  const latest = latestThreadInvalidations(events);
  const checkpoints: Promise<void>[] = [];
  for (const [threadId, cursor] of latest) {
    const id = invalidationKey(connectionId, threadId);
    const current = collection.get(id);
    if (current !== undefined && current.cursor >= cursor) continue;
    const { checkpoint } = commitUiCacheMutationCheckpointed(
      THREAD_INVALIDATION_COLLECTION_ID,
      () => current === undefined
        ? collection.insert({ id, connectionId, threadId, cursor })
        : collection.update(id, (draft) => { draft.cursor = cursor; }),
      { forceFlush: durable },
    );
    checkpoints.push(checkpoint);
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
  const { checkpoint } = commitUiCacheMutationCheckpointed(
    THREAD_INVALIDATION_COLLECTION_ID,
    () => collection.delete(id),
    { forceFlush: true },
  );
  await checkpoint;
}

function invalidationKey(connectionId: string, threadId: string): string {
  return `${connectionId}\u0000${threadId}`;
}

function rowsForThread(connectionId: string, thread: Thread, sessionId: string, lastOpenedAt: number): Map<string, ThreadDetailRow> {
  const result = new Map<string, ThreadDetailRow>();
  const meta = threadRow(connectionId, thread, sessionId, lastOpenedAt);
  result.set(meta.id, meta);
  thread.turns.forEach((turn, ordinal) => {
    const content = turnRow(connectionId, thread.id, turn, ordinal);
    result.set(content.id, content);
    const metadata = projectedTurnMetadata(turn);
    if (metadata !== null) {
      const row = turnMetaRow(connectionId, thread.id, turn.id, metadata, ordinal, turn.status !== "inProgress");
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

function threadRow(connectionId: string, thread: Thread, sessionId: string | null, lastOpenedAt: number): ThreadDetailRow {
  return {
    ...baseRow(threadMetaKey(connectionId, thread.id), "thread", connectionId, thread.id, null, -1, sessionId, lastOpenedAt),
    thread: stripThreadTurns(thread),
  };
}

function turnRow(connectionId: string, threadId: string, turn: Turn, ordinal: number): ThreadDetailRow {
  return {
    ...baseRow(turnStorageKey(connectionId, threadId, turn), "turn", connectionId, threadId, turn.id, ordinal, null, 0),
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
): ThreadDetailRow {
  return {
    ...baseRow(turnMetaKey(connectionId, threadId, turnId), "turnMeta", connectionId, threadId, turnId, ordinal, null, 0),
    sealed,
    turnMetadata: structuredClone(metadata),
  };
}

function activityRow(connectionId: string, threadId: string, turnId: string, ordinal: number, items: Turn["items"]): ThreadDetailRow {
  return {
    ...baseRow(activityKey(connectionId, threadId, turnId), "activity", connectionId, threadId, turnId, ordinal, null, 0),
    sealed: true,
    activityItems: structuredClone(items),
  };
}

function pendingRow(connectionId: string, threadId: string, entry: PendingTimelineEntry): ThreadDetailRow {
  return {
    ...baseRow(pendingTimelineRowId(connectionId, threadId, entry.commandId), "pending", connectionId, threadId, null, entry.order, null, 0),
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
  if (mutationCount === 0) controls.commit();
  else await commitUiCacheSyncDurably(THREAD_DETAIL_COLLECTION_ID, controls.commit);
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
