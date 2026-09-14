import type { ThreadDetailDatabase, ThreadWindowCoverage, ThreadRemoteLoader, ThreadHistoryAppendResult } from "./thread-detail-database-contract";
export type { ThreadDetailDatabase, ThreadWindowCoverage, ThreadRemoteLoader, ThreadRemoteNewerResult, ThreadRemoteOlderResult, ThreadHistoryPrependResult, ThreadHistoryAppendResult, ThreadSnapshotImportReason, ThreadSnapshotSyncMode, ThreadSynchronization, PendingTimelineInput } from "./thread-detail-database-contract";
import type { Thread, Turn } from "@codewide/codex-protocol/v0.147.0/v2";
import { applyThreadProjectionPatchesImmutable, preserveProjectedTurnMetadata, projectedTurnMetadata, threadIdFromEvent, threadProjectionNeedsAuthoritativeRepair, threadProjectionPatchFromEvent, type ThreadProjectionPatchV1, type ProjectedTurnMetadata } from "@codewide/sync-client";
import { registerUiCacheCollectionFlusher } from "./ui-cache-persistence.native";
import { commandReceiptsFromOperation, commandReceiptsFromTurn, type CommandReceipt } from "./command-receipt-evidence";
import {
  compactCompletedTurnForStorage,
  authoritativeTimelineRowId,
  materializeThreadDetail,
  mergePendingTimelineOverlays,
  mergePendingTimelineEntry,
  normalizeConversationTurn,
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
import { cloneProtocolValue } from "./clone-protocol-value";
import { residentThreadWindow } from "./resident-thread-window";

import type { NativeCommandDelivery } from "../native/native-transport";
import { pendingDeliveryStateFromCompanion, pendingDeliveryStateFromNative } from "./thread-delivery-state";

import { parseQueuedInput } from "./queued-input";
import { SerialTaskQueue } from "./serial-task-queue";
import { createThreadChatModel, threadChatRequestKey, threadChatScope, type ThreadChatWindowRequest, type ThreadChatWindowSnapshot } from "./thread-chat-model";
import { setThreadDetailResidentRows } from "./operational-metrics";
import {
  activeThreadNavigationIdFor,
  recordThreadNavigationMeasure,
  recordThreadNavigationVisualEvent,
} from "./thread-navigation-metrics";
import {
  createThreadDetailSqlite,
  type ResolvedThreadDetailWindow,
  type ThreadDetailSqliteControls,
  type ThreadDetailSqliteDiagnostics,
} from "./thread-detail-sqlite.native";
import { ThreadWindowIntentController } from "./thread-window-intent";
import { THREAD_HISTORY_PAGE_SIZE, THREAD_RESIDENT_TURN_LIMIT } from "./thread-pagination";
import { advanceThreadUsage, latestThreadUsage, type ThreadCurrentUsage } from "./thread-current-usage";
import { advanceThreadOutcome, latestThreadOutcome, type ThreadCurrentOutcome } from "./thread-current-outcome";
import { threadLoadHasResidentSnapshot } from "./thread-load-status";
import { recordThreadHistoryTelemetry, recordThreadOpeningMeasure, telemetryErrorKind } from "./thread-history-telemetry";

const THREAD_DETAIL_COLLECTION_ID = "thread-details-v2";
const OPTIMISTIC_RECONCILIATION_STALL_MS = 30_000;

export { materializePendingTimeline, materializeThreadDetails, materializeThreadTurns } from "./thread-detail-projection";
export type { PendingTimelineEntry, ThreadDetailRow, ThreadDetailSnapshot } from "./thread-detail-projection";

type SyncControls = ThreadDetailSqliteControls;
type SyncWriteControls = Pick<SyncControls, "write">;

type OrdinalBounds = { min: number; max: number; dirty: boolean };

/**
 * Incremental index over the rows the active Legend chat windows hydrate. History can
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

  historyCursor(connectionId: string, threadId: string): string | null | undefined {
    const meta = super.get(threadMetaKey(connectionId, threadId));
    return meta?.kind === "thread" ? meta.historyCursor : undefined;
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

type ThreadDetailTransactionResult<T> = {
  value: T;
  durable: boolean;
};

/**
 * Owns both halves of one detail write: the SQLite staging map and the indexed
 * resident source. The mutation callback is intentionally synchronous so no
 * second writer can enter while this logical transaction is open.
 */
async function runThreadDetailTransaction<T>(
  source: ThreadDetailSource,
  controls: SyncControls,
  mutate: (writes: SyncWriteControls) => ThreadDetailTransactionResult<T>,
  onRollback?: () => void,
): Promise<T> {
  const previousRows = new Map<string, ThreadDetailRow | undefined>();
  const writes: SyncWriteControls = {
    write(change) {
      const key = change.type === "delete" ? change.key : change.value.id;
      if (!previousRows.has(key)) previousRows.set(key, source.get(key));
      controls.write(change);
    },
  };
  controls.begin({ immediate: true });
  let committed = false;
  try {
    const result = mutate(writes);
    const checkpoint = controls.commit({ durable: result.durable });
    // commit() releases the logical transaction synchronously. A later
    // durable-checkpoint rejection is retried by the SQLite adapter and must
    // not rewind the already published resident model.
    committed = true;
    await checkpoint;
    return result.value;
  } catch (cause) {
    if (!committed) {
      controls.rollback();
      for (const [key, previous] of previousRows) {
        if (previous === undefined) source.delete(key);
        else source.set(key, previous);
      }
      onRollback?.();
    }
    throw cause;
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
  // set of those empty shells so their live events can restart the window
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
  const rangePulls = new Map<string, Promise<boolean>>();
  // Process-local only: this counter closes the RPC-response/live-patch write
  // race. It is not a protocol cursor, persisted epoch, or replay mechanism.
  const liveRevisions = new Map<string, number>();
  const projectionSnapshots = new Map<string, { promise: Promise<void>; resolve(): void }>();
  const reportedStalledOptimisticFingerprintByThread = new Map<string, string>();
  let storageDiagnosticsPromise: Promise<ThreadDetailSqliteDiagnostics> | null = null;
  let storageDiagnosticsReported = false;
  let remoteLoader: ThreadRemoteLoader | null = null;
  const newerExhaustedTurnIdByThread = new Map<string, string>();
  const olderExhaustedTurnIdByThread = new Map<string, string>();
  let historyExhaustionRevision = 0;
  const rangePersistenceScopes = new Set<string>();

  const invalidateHistoryExhaustion = (connectionId: string, threadId?: string): void => {
    historyExhaustionRevision += 1;
    const prefix = threadId === undefined ? `${connectionId}\u0000` : `${threadChatScope(connectionId, threadId)}\u0000`;
    for (const key of newerExhaustedTurnIdByThread.keys()) if (key.startsWith(prefix)) newerExhaustedTurnIdByThread.delete(key);
    for (const key of olderExhaustedTurnIdByThread.keys()) if (key.startsWith(prefix)) olderExhaustedTurnIdByThread.delete(key);
  };

  const detailStorage = createThreadDetailSqlite((changes) => {
    // An anchored page grants durable membership only. Its range pull publishes
    // the selected contiguous page without making it look like a live tail update.
    const published = rangePersistenceScopes.size === 0 ? changes : changes.filter((change) => {
      const row = change.type === "delete" ? chat.row$(change.key).peek() : change.value;
      return row === null || !rangePersistenceScopes.has(threadChatScope(row.connectionId, row.remoteThreadId));
    });
    const touched = new Map<string, { connectionId: string; threadId: string }>();
    for (const change of published) {
      const row = change.type === "delete" ? chat.row$(change.key).peek() : change.value;
      if (row !== null) touched.set(threadChatScope(row.connectionId, row.remoteThreadId), {
        connectionId: row.connectionId,
        threadId: row.remoteThreadId,
      });
    }
    chat.publishChanges(published);
    for (const { connectionId, threadId } of touched.values()) {
      chat.refreshThread(connectionId, threadId, source.rowsForThread(connectionId, threadId));
    }
  });
  const unregisterDetailFlusher = registerUiCacheCollectionFlusher(THREAD_DETAIL_COLLECTION_ID, detailStorage.flush);
  const confirmCommandReceipts = async (connectionId: string, receipts: readonly CommandReceipt[]): Promise<void> => {
    if (receipts.length === 0) return;
    await writes.run(async () => {
      if (disposed) throw new Error("Thread detail database is closed");
      // An upstream receipt may beat the JS continuation that commits the
      // staged prompt after native enqueue. Persist that owned intent first.
      await runWriteTransaction((controls) => {
        let changed = false;
        for (const receipt of receipts) {
          const key = pendingTimelineRowId(connectionId, receipt.threadId, receipt.commandId);
          const staged = stagedPendingOverlays.get(key)?.row;
          if (staged?.kind !== "pending" || source.get(key)?.kind === "turn") continue;
          controls.write({ type: "update", value: staged });
          changed = true;
        }
        return { value: undefined, durable: changed };
      });
      const confirmed = await detailStorage.confirmCommandReceipts(connectionId, receipts);
      for (const row of confirmed) {
        const staged = stagedPendingOverlays.get(row.id);
        if (staged !== undefined) stagedPendingOverlays.set(row.id, { ...staged, row });
        // SQLite owns off-screen receipts. Do not recreate a window to report one.
        if (source.get(row.id)?.kind === "pending") {
          source.set(row.id, row);
          chat.publishChanges([{ type: "update", value: row }]);
          chat.refreshThread(connectionId, row.remoteThreadId, source.rowsForThread(connectionId, row.remoteThreadId));
        }
        const receipt = row.pending?.confirmation;
        if (receipt !== undefined) recordThreadHistoryTelemetry(connectionId, row.remoteThreadId,
          "chat.delivery.confirmation_persisted", { requestId: receipt.commandId, turnId: receipt.turnId,
            itemId: receipt.itemId, tags: { projection: source.has(threadMetaKey(connectionId, row.remoteThreadId)) ? "resident" : "unloaded" } });
      }
    });
  };
  const reportStorageDiagnostics = (connectionId: string, threadId: string): void => {
    if (storageDiagnosticsReported) return;
    storageDiagnosticsPromise ??= detailStorage.diagnostics();
    void storageDiagnosticsPromise.then((diagnostics) => {
      if (storageDiagnosticsReported) return;
      storageDiagnosticsReported = true;
      recordThreadHistoryTelemetry(connectionId, threadId, "cache.ui_sqlite_storage", {
        values: diagnostics,
        tags: {
          rotation: diagnostics.historyFamiliesEvicted > 0 ? "evicted" : "within_limit",
          startupCleanup: diagnostics.staleDeliveryRowsRemoved > 0 ? "removed" : "clean",
        },
      });
    }).catch((cause: unknown) => {
      storageDiagnosticsPromise = null;
      console.warn("UI cache SQLite diagnostics failed", cause);
    });
  };
  const liveRevision = (connectionId: string, threadId: string): number => (
    liveRevisions.get(threadScope(connectionId, threadId)) ?? 0
  );
  const advanceLiveRevision = (connectionId: string, threadId: string): void => {
    const scope = threadScope(connectionId, threadId);
    liveRevisions.set(scope, liveRevision(connectionId, threadId) + 1);
  };
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
    const resident = source.rowsForThread(connectionId, threadId);
    const metadata = resident.find((row) => row.kind === "thread");
    if (metadata !== undefined && incomingTurnIds.every((id) => resident.some((row) => (
      row.kind === "turn" && row.remoteTurnId === id && row.historyEpoch === metadata.historyEpoch
    )))) return resident;
    // Authoritative projection cannot rely on the current in-memory window: it
    // may still be loading or may not contain the incoming turn family. Read
    // only the durable facts required to
    // establish the current epoch and anchor this bounded server page.
    return await detailStorage.loadAuthoritativeFacts(connectionId, threadId, incomingTurnIds);
  };

  const ensureControls = (): SyncControls => {
    return detailStorage;
  };

  const runWriteTransaction = async <T>(
    mutate: (writes: SyncWriteControls) => ThreadDetailTransactionResult<T>,
  ): Promise<T> => {
    const previousOverlays = new Map(stagedPendingOverlays);
    return await runThreadDetailTransaction(source, ensureControls(), mutate, () => {
      stagedPendingOverlays.clear();
      for (const [key, overlay] of previousOverlays) stagedPendingOverlays.set(key, overlay);
    });
  };

  const writeOwnedRow = (controls: SyncWriteControls, key: string, row: ThreadDetailRow): boolean => {
    // Once the server claims a stable client-id key, no older optimistic
    // transaction may roll it back or persist a pending tombstone over it.
    if (row.kind === "turn") stagedPendingOverlays.delete(key);
    return writeRow(source, controls, key, row);
  };

  const commitThreadTurn = (
    controls: SyncWriteControls,
    input: {
      connectionId: string;
      threadId: string;
      turn: Turn;
      ordinal: number;
      historyEpoch: number;
      authority: "live" | "authoritative";
      facts: readonly ThreadDetailRow[];
    },
  ): number => {
    const fact = input.facts.find((row) => row.kind === "turn" && row.remoteTurnId === input.turn.id);
    const previousKey = source.turnRowKey(input.connectionId, input.threadId, input.turn.id) ?? fact?.id ?? null;
    const previousByTurnId = previousKey === null ? undefined : source.get(previousKey) ?? fact;
    const residentTurn = previousByTurnId?.kind === "turn" ? previousByTurnId.turn : null;
    const sourceTurn = normalizeConversationTurn(input.turn, residentTurn);
    const completeEnvelope = sourceTurn === input.turn;
    // A live completion is still the mutable journal head. Keep its full item
    // projection in the turn row so leaving and reopening the chat cannot turn
    // an already received tool call into a summary-only turn before the
    // authoritative repair arrives. A metadata-only recovery envelope follows
    // the same rule: it may update lifecycle state, but cannot seal or compact
    // content that it did not carry.
    const turn = input.authority === "authoritative" && completeEnvelope
      ? compactCompletedTurnForStorage(sourceTurn)
      : sourceTurn;
    const key = turnStorageKey(input.connectionId, input.threadId, turn);
    const previous = previousKey === null ? source.get(key) : previousByTurnId;
    const incoming = turnRow(
      input.connectionId,
      input.threadId,
      turn,
      input.ordinal,
      input.historyEpoch,
      input.authority === "authoritative" && completeEnvelope ? "authoritative" : "live",
    );
    const content = input.authority === "authoritative"
      ? reconcileAuthoritativeThreadDetailRow(previous, incoming)
      : incoming;
    const contentOrdinal = content.ordinal;
    const contentSealed = content.sealed;
    let mutationCount = 0;

    if (previousKey !== null && previousKey !== content.id && previous !== content) {
      if (deleteRow(source, controls, previousKey)) mutationCount += 1;
    }
    const shouldWriteContent = input.authority === "authoritative"
      ? shouldWriteAuthoritativeThreadDetailRow(previous, content)
      : shouldWriteThreadDetailRow(previous, content);
    if (shouldWriteContent && writeOwnedRow(controls, content.id, content)) mutationCount += 1;

    // A sealed turn is one immutable fact family: content, metadata and
    // ordinal must all come from the same commit. When reconciliation keeps
    // the previous sealed content, its existing metadata row stays untouched.
    const metadata = content === previous ? null : projectedTurnMetadata(turn);
    if (metadata !== null) {
      const row = turnMetaRow(
        input.connectionId,
        input.threadId,
        turn.id,
        metadata,
        contentOrdinal,
        contentSealed,
        input.historyEpoch,
      );
      if (writeOwnedRow(controls, row.id, row)) mutationCount += 1;
    }

    // When the authoritative projection seals and compacts a turn, preserve
    // the richest full projection that is already local as its activity
    // overlay. A cursor catch-up commonly returns itemsView=summary; without
    // this handoff it replaced the mutable full row and permanently discarded
    // tool calls that had arrived through the live journal.
    const overlayKey = activityKey(input.connectionId, input.threadId, turn.id);
    const fullActivitySource = sourceTurn.itemsView === "full"
      ? sourceTurn
      : previous?.kind === "turn" && previous.turn?.itemsView === "full"
        ? previous.turn
        : null;
    if (contentSealed && turn.itemsView === "summary" && fullActivitySource !== null) {
      const row = activityRow(
        input.connectionId,
        input.threadId,
        turn.id,
        contentOrdinal,
        fullActivitySource.items,
        input.historyEpoch,
      );
      if (shouldWriteThreadDetailRow(source.get(overlayKey) ?? input.facts.find((value) => value.id === overlayKey), row)
        && writeOwnedRow(controls, overlayKey, row)) mutationCount += 1;
    }

    // Activity is part of the same ordered turn family and follows its
    // canonical ordinal/history generation in the same SQLite transaction.
    const overlay = source.get(overlayKey) ?? input.facts.find((row) => row.id === overlayKey);
    if (overlay !== undefined
      && (overlay.historyEpoch !== input.historyEpoch || overlay.ordinal !== contentOrdinal)) {
      if (writeOwnedRow(controls, overlayKey, {
        ...overlay,
        historyEpoch: input.historyEpoch,
        ordinal: contentOrdinal,
      })) mutationCount += 1;
    }
    return mutationCount;
  };

  const commitThreadProjection = async (input: {
    connectionId: string;
    threadId: string;
    turns: readonly Turn[];
    ordinals: ReadonlyMap<string, number>;
    historyEpoch: number;
    authority: "live" | "authoritative";
    threadMeta?: ThreadDetailRow;
    historyCursor?: { value: string | null };
    pruneMissingMutable?: boolean;
    replaceExisting?: boolean;
    durable: boolean;
    facts?: readonly ThreadDetailRow[];
    mutableRepositions?: readonly ThreadDetailRow[];
  }): Promise<number> => await runWriteTransaction((controls) => {
    let mutationCount = 0;

    if (input.replaceExisting === true) {
      for (const row of source.rowsForThread(input.connectionId, input.threadId)) {
        if (row.kind === "pending") continue;
        if (deleteRow(source, controls, row.id)) mutationCount += 1;
      }
    }

    if (input.threadMeta !== undefined) {
      if (writeOwnedRow(controls, input.threadMeta.id, input.threadMeta)) mutationCount += 1;
    } else if (input.historyCursor !== undefined) {
      const metaKey = threadMetaKey(input.connectionId, input.threadId);
      const meta = source.get(metaKey);
      if (meta?.kind === "thread" && meta.historyCursor !== input.historyCursor.value) {
        if (writeOwnedRow(controls, metaKey, { ...meta, historyCursor: input.historyCursor.value })) mutationCount += 1;
      }
    }

    for (const row of input.mutableRepositions ?? []) {
      if (writeOwnedRow(controls, row.id, row)) mutationCount += 1;
    }

    if (input.pruneMissingMutable === true) {
      const incomingTurnIds = new Set(input.turns.map(({ id }) => id));
      for (const row of source.rowsForThread(input.connectionId, input.threadId)) {
        if (row.kind !== "turn" || row.sealed || row.remoteTurnId === null || incomingTurnIds.has(row.remoteTurnId)) continue;
        if (deleteRow(source, controls, row.id)) mutationCount += 1;
        if (deleteRow(source, controls, turnMetaKey(input.connectionId, input.threadId, row.remoteTurnId))) mutationCount += 1;
        if (deleteRow(source, controls, activityKey(input.connectionId, input.threadId, row.remoteTurnId))) mutationCount += 1;
      }
    }

    for (const turn of input.turns) {
      const ordinal = input.ordinals.get(turn.id);
      if (ordinal === undefined) throw new Error(`Missing ordinal for turn ${turn.id}`);
      mutationCount += commitThreadTurn(controls, {
        connectionId: input.connectionId,
        threadId: input.threadId,
        turn,
        ordinal,
        historyEpoch: input.historyEpoch,
        authority: input.authority,
        facts: input.facts ?? [],
      });
    }

    return { value: mutationCount, durable: mutationCount > 0 && input.durable };
  });

  const persistPendingMutation = async (
    mutation: PendingTimelineMutation,
    durable = false,
  ): Promise<boolean> => await writes.run(async () => {
    if (disposed) return false;
    const volatileChanges: Array<
      { type: "insert" | "update"; value: ThreadDetailRow }
      | { type: "delete"; key: string }
    > = [];
    const touchedVolatileScopes = new Map<string, { connectionId: string; threadId: string }>();
    await runWriteTransaction((controls) => {
      let persistentChanged = false;
      for (const key of mutation.deletes) {
        const previous = source.get(key);
        // An authoritative turn owns the stable client-id row forever. A late
        // queue receipt must never delete or replace real server content.
        if (previous?.kind === "turn") {
          stagedPendingOverlays.delete(key);
          continue;
        }
        const confirmation = previous?.pending?.confirmation;
        if (previous?.kind === "pending" && confirmation !== undefined) {
          const canonicalKey = source.turnRowKey(previous.connectionId, previous.remoteThreadId, confirmation.turnId);
          const canonical = canonicalKey === null ? undefined : source.get(canonicalKey);
          if (!canonical?.turn?.items.some((item) => item.type === "userMessage"
            && item.clientId === confirmation.commandId)) continue;
        }
        if (previous?.kind === "pending") {
          if (deleteRow(source, controls, key)) persistentChanged = true;
          volatileChanges.push({ type: "delete", key });
          touchedVolatileScopes.set(threadScope(previous.connectionId, previous.remoteThreadId), {
            connectionId: previous.connectionId,
            threadId: previous.remoteThreadId,
          });
        } else if (stagedPendingOverlays.has(key)) {
          // The optimistic overlay can exist before its durable row is visible.
          controls.write({ type: "delete", key });
          persistentChanged = true;
        }
        // A removed optimistic row must not be resurrected by the next SQLite
        // window install. The overlay only protects the command while its native
        // acceptance transaction is genuinely in flight.
        stagedPendingOverlays.delete(key);
      }
      for (const row of mutation.upserts) {
        if (row.kind !== "pending" || row.pending === null || row.pending === undefined) continue;
        const previous = source.get(row.id);
        if (previous?.kind === "turn") continue;
        const next = previous?.kind === "pending" && previous.pending !== null && previous.pending !== undefined
          ? { ...row, pending: mergePendingTimelineEntry(previous.pending, row.pending) }
          : row;
        if (writeOwnedRow(controls, next.id, next)) persistentChanged = true;
        else if (stagedPendingOverlays.has(next.id)) {
          controls.write({ type: "update", value: next });
          persistentChanged = true;
        }
      }
      return { value: undefined, durable: durable && persistentChanged };
    });
    if (volatileChanges.length > 0) {
      chat.publishChanges(volatileChanges);
      for (const { connectionId, threadId } of touchedVolatileScopes.values()) {
        chat.refreshThread(connectionId, threadId, source.rowsForThread(connectionId, threadId));
      }
    }
    return true;
  });

  const persistPendingRow = async (row: ThreadDetailRow, durable = false): Promise<boolean> => (
    await persistPendingMutation({ upserts: [row], deletes: [] }, durable)
  );

  const applyCommandDelivery = async (
    delivery: NativeCommandDelivery,
    allowInsert = false,
  ): Promise<void> => {
    if (disposed) return;
    const direct = delivery.method === "turn/start" || delivery.method === "turn/steer";
    if (direct && delivery.threadId !== null) {
      const existing = source.pendingRow(delivery.connectionId, delivery.commandId);
      // A delta event may only advance an optimistic row that already exists.
      // On reconnect Kotlin can briefly replay old uncertain commands through
      // `sending` before the host deduplicates them. Materializing those deltas
      // as new rows makes dozens of historical bubbles flash into the resident
      // window. Only a full native-ledger reconciliation may reconstruct a
      // missing non-terminal row after process death. A bare delivered receipt
      // is not enough to reconstruct UI: old receipts can outlive their
      // canonical turns, including turns outside the resident SQLite window.
      if (existing === undefined && (delivery.state === "delivered"
        || !allowInsert
        || !source.has(threadMetaKey(delivery.connectionId, delivery.threadId)))) return;
      const entry: PendingTimelineEntry = {
        commandId: delivery.commandId,
        method: delivery.method === "turn/steer" ? "turn/steer" : "turn/start",
        presentation: existing?.pending?.presentation ?? "delivery",
        text: delivery.text,
        attachments: existing?.pending?.attachments ?? delivery.attachments,
        state: pendingDeliveryStateFromNative(delivery.state),
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
    if (current.pending.confirmation !== undefined) return;
    if (delivery.method === "companion/queue/cancel" && delivery.state === "delivered") {
      await persistPendingMutation({ upserts: [], deletes: [current.id] });
      return;
    }
    // Edit, move, and retry receipts describe completion of the management
    // command, not delivery of the queued prompt itself. The Companion queue
    // snapshot remains authoritative for that prompt, so a successful
    // non-consuming mutation must leave it queued.
    const preservesQueuedItem = delivery.method === "companion/queue/put"
      || delivery.method === "companion/queue/edit"
      || delivery.method === "companion/queue/move"
      || delivery.method === "companion/queue/retry";
    const state: PendingTimelineEntry["state"] = delivery.state === "delivered" && preservesQueuedItem
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
    mode: "authoritative" | "reset" | "live" | "append" | "tail",
    openedAt = Date.now(),
    preserveConcurrentHead = false,
    suppliedHistoryCursor?: string | null,
    suppliedProjectionCursor?: number,
    suppliedSourceWitness?: string,
    isCurrent: () => boolean = () => true,
  ): Promise<void> => {
    if (!isCurrent()) return;
    if (disposed) throw new Error("Thread detail database is closed");
    const facts = mode === "authoritative" || mode === "append" || mode === "tail"
      ? await loadDurableAuthoritativeRows(
        connectionId,
        incoming.id,
        incoming.turns.map((turn) => turn.id),
      ) : [];
    if (!isCurrent()) return;
    // Lookup facts prove positions and reuse content; they do not grant resident membership.
    const existingRows = mergeHistoryFacts(facts, source.rowsForThread(connectionId, incoming.id));
    const currentHistoryEpoch = existingRows.find((row) => row.kind === "thread")?.historyEpoch ?? 0;
    const currentRows = existingRows.filter((row) => row.kind === "thread" || row.kind === "pending" || row.historyEpoch === currentHistoryEpoch);
    const incomingHistoryTurns = incoming.turns.filter((turn) => turn.status !== "inProgress");
    const projectedHistoryEpoch = projectAuthoritativeHistoryEpoch(existingRows, incomingHistoryTurns.map((turn) => turn.id));
    const previousMeta = existingRows.find((row) => row.kind === "thread");
    const currentHistoryTurnIds = currentRows
      .filter((row) => row.kind === "turn" && row.sealed && row.remoteTurnId !== null)
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((row) => row.remoteTurnId);
    const incomingHistoryTurnIds = incomingHistoryTurns.map((turn) => turn.id);
    const tailAlreadyCurrent = mode === "tail"
      && previousMeta?.historyCursor === suppliedHistoryCursor
      && currentHistoryTurnIds.length === incomingHistoryTurnIds.length
      && currentHistoryTurnIds.every((turnId, index) => turnId === incomingHistoryTurnIds[index]);
    const historyEpoch = mode === "tail"
      ? tailAlreadyCurrent ? currentHistoryEpoch : currentHistoryEpoch + 1
      : mode === "reset" && previousMeta !== undefined
      ? currentHistoryEpoch + 1
      : mode === "authoritative" || mode === "reset"
      ? projectedHistoryEpoch
      : currentHistoryEpoch;
    const authoritativeDisconnected = historyEpoch !== currentHistoryEpoch;
    if (authoritativeDisconnected) invalidateHistoryExhaustion(connectionId, incoming.id);
    const projectionCursor = suppliedProjectionCursor ?? previousMeta?.projectionCursor;
    const historyCursor = mode === "reset" || mode === "tail"
      ? suppliedHistoryCursor
      : authoritativeDisconnected
      ? suppliedHistoryCursor
      : previousMeta?.historyCursor === undefined ? suppliedHistoryCursor : previousMeta.historyCursor;
    const historyHadTurns = mode === "reset"
      ? incomingHistoryTurns.length > 0 || typeof suppliedHistoryCursor === "string"
      : previousMeta?.historyHadTurns === true
      || incomingHistoryTurns.length > 0
      || existingRows.some((row) => row.kind === "turn")
      || typeof suppliedHistoryCursor === "string"
      ? true
      : mode === "authoritative" && suppliedHistoryCursor !== undefined
        ? false
        : previousMeta?.historyHadTurns;
    const currentSnapshot = materializeThreadDetail(currentRows, connectionId, incoming.id, sessionId);
    const current = currentSnapshot?.thread;
    const authoritative = mode === "authoritative" && currentSnapshot?.fresh === true
      ? preserveProjectedTurnMetadata(incoming, current)
      : incoming;
    const mutableTurnIds = new Set(currentRows.flatMap((row) => (
      row.kind === "turn" && !row.sealed && row.remoteTurnId !== null ? [row.remoteTurnId] : []
    )));
    const concurrentHead = preserveConcurrentHead && current !== null && current !== undefined
      ? { ...current, turns: current.turns.filter((turn) => mutableTurnIds.has(turn.id)) }
      : null;
    const thread = reconcileAuthoritativeThread(authoritative, concurrentHead, preserveConcurrentHead);
    const ordinalSourceRows = mode === "reset" || authoritativeDisconnected ? [] : currentRows;
    const authoritativeOrdinals = projectAuthoritativeTurnOrdinals(ordinalSourceRows, thread.turns.map((turn) => turn.id));
    const coverage = projectAuthoritativeCoverage(
      previousMeta,
      existingRows,
      currentHistoryEpoch,
      historyEpoch,
      incomingHistoryTurns,
      authoritativeOrdinals,
      mode,
      historyHadTurns,
    );
    await commitThreadProjection({
      connectionId,
      threadId: thread.id,
      turns: thread.turns,
      ordinals: authoritativeOrdinals,
      historyEpoch,
      authority: mode === "live" ? "live" : "authoritative",
      threadMeta: threadRow(
        connectionId,
        thread,
        sessionId,
        openedAt,
        historyEpoch,
        historyCursor,
        historyHadTurns,
        coverage.min,
        coverage.max,
        projectionCursor,
        suppliedSourceWitness ?? previousMeta?.historySourceWitness,
        mode === "append" ? previousMeta?.currentUsage ?? null : mode === "live"
          ? advanceThreadUsage(previousMeta?.currentUsage ?? null, thread.turns)
          : latestThreadUsage(thread.turns) ?? (mode === "reset" ? null : previousMeta?.currentUsage ?? null),
        mode === "append" ? previousMeta?.currentOutcome ?? null : mode === "live"
          ? advanceThreadOutcome(previousMeta?.currentOutcome ?? null, thread.turns)
          : latestThreadOutcome(thread.turns) ?? (mode === "reset" ? null : previousMeta?.currentOutcome ?? null),
      ),
      // A bounded refresh keeps sealed history outside the tail page and
      // removes only mutable turns absent from the authoritative result.
      pruneMissingMutable: mode === "authoritative",
      replaceExisting: mode === "reset",
      durable: true,
      facts,
    });
  };

  const publishLiveSlice = async (connectionId: string, thread: Thread, startedTurnId: string | null = null): Promise<void> => {
    if (disposed) return;
    const metaKey = threadMetaKey(connectionId, thread.id);
    const previousMeta = source.get(metaKey);
    if (previousMeta?.kind !== "thread") return;
    const historyEpoch = previousMeta.historyEpoch;
    // A historical resident window can end before the known durable tail.
    let nextOrdinal = Math.max(source.ordinalBounds(connectionId, thread.id, historyEpoch)?.max ?? -1,
      previousMeta.historyCoverageMaxOrdinal ?? -1) + 1;
    const ordinals = new Map<string, number>();
    for (const rawTurn of thread.turns) {
      const previousKey = source.turnRowKey(connectionId, thread.id, rawTurn.id);
      const previous = previousKey === null ? undefined : source.get(previousKey);
      const currentByKey = source.get(turnStorageKey(connectionId, thread.id, rawTurn));
      const ordinal = reusableTurnOrdinal(previous, historyEpoch)
        ?? reusableTurnOrdinal(currentByKey, historyEpoch)
        ?? nextOrdinal++;
      ordinals.set(rawTurn.id, ordinal);
    }
    await commitThreadProjection({
      connectionId,
      threadId: thread.id,
      turns: thread.turns,
      ordinals,
      historyEpoch,
      authority: "live",
      threadMeta: threadRow(
        connectionId,
        thread,
        previousMeta.sessionId,
        previousMeta.lastOpenedAt,
        historyEpoch,
        previousMeta.historyCursor,
        previousMeta.historyHadTurns === true
          || thread.turns.length > 0
          || source.rowsForThread(connectionId, thread.id).some((row) => row.kind === "turn"),
        previousMeta.historyCoverageMinOrdinal,
        previousMeta.historyCoverageMaxOrdinal,
        previousMeta.projectionCursor,
        previousMeta.historySourceWitness,
        advanceThreadUsage(previousMeta.currentUsage ?? null, thread.turns),
        advanceThreadOutcome(previousMeta.currentOutcome ?? null, thread.turns, startedTurnId),
      ),
      durable: true,
    });
  };

  const persistAnchoredPage = async (input: {
    connectionId: string;
    threadId: string;
    historyEpoch: number;
    anchorTurnId: string;
    turns: Turn[];
    sourceWitness: string;
    requestedSourceWitness: string | undefined;
    isCurrent(): boolean;
  } & ({ direction: "newer" } | { direction: "older"; hasMore: boolean })): Promise<ThreadHistoryAppendResult> => await writes.run(async () => {
    const current = (): boolean => !disposed && !closing && input.isCurrent()
      && source.historyEpoch(input.connectionId, input.threadId) === input.historyEpoch;
    const rejected = (): ThreadHistoryAppendResult => ({ accepted: false, historyEpoch: source.historyEpoch(input.connectionId, input.threadId) });
    if (!current()) return rejected();
    const ids = input.direction === "newer"
      ? [input.anchorTurnId, ...input.turns.map((turn) => turn.id)]
      : [...input.turns.map((turn) => turn.id), input.anchorTurnId];
    const durableFacts = await detailStorage.loadAuthoritativeFacts(input.connectionId, input.threadId, ids);
    if (!current()) return rejected();
    const facts = mergeHistoryFacts(durableFacts, source.rowsForThread(input.connectionId, input.threadId));
    const metadata = facts.find((row) => row.kind === "thread");
    const anchor = facts.find((row) => row.kind === "turn" && row.sealed
      && row.historyEpoch === input.historyEpoch && row.remoteTurnId === input.anchorTurnId);
    if (metadata?.thread === null || metadata === undefined || metadata.historyEpoch !== input.historyEpoch || anchor === undefined) return rejected();
    // An unwitnessed cache admits only the first source-qualified response.
    // Other requests started without that witness may describe a replaced source.
    // Nonempty checkpoints can differ across valid append-compatible responses.
    if (input.requestedSourceWitness === undefined && metadata.historySourceWitness !== undefined) return rejected();
    const base = input.direction === "newer" ? anchor.ordinal + 1 : anchor.ordinal - input.turns.length;
    const ordinals = new Map(input.turns.map((turn, index) => [turn.id, base + index]));
    const idsByOrdinal = new Map(input.turns.map((turn, index) => [base + index, turn.id]));
    // A response must agree with every already sealed overlap, not only its first neighbor.
    for (const row of facts) {
      if (row.kind !== "turn" || !row.sealed || row.historyEpoch !== input.historyEpoch || row.remoteTurnId === null) continue;
      const expectedOrdinal = ordinals.get(row.remoteTurnId);
      const expectedId = idsByOrdinal.get(row.ordinal);
      if ((expectedOrdinal !== undefined && expectedOrdinal !== row.ordinal)
        || (expectedId !== undefined && expectedId !== row.remoteTurnId)) return rejected();
    }
    let historyCursor = metadata.historyCursor;
    if (input.direction === "older") {
      const minimum = await detailStorage.loadBoundary(input.connectionId, input.threadId, input.historyEpoch, "asc");
      if (!current()) return rejected();
      if (!input.hasMore && (minimum === null || base <= minimum.ordinal)) historyCursor = null;
    }
    if (input.turns.length === 0 && historyCursor === metadata.historyCursor && input.sourceWitness === metadata.historySourceWitness) {
      return { accepted: true, historyEpoch: input.historyEpoch };
    }
    const coverage = extendAuthoritativeCoverage(metadata, input.turns, ordinals);
    const mutableRepositions: ThreadDetailRow[] = [];
    const sealedMaximum = facts.reduce((maximum, row) => row.kind === "turn" && row.sealed && row.historyEpoch === input.historyEpoch
      ? Math.max(maximum, row.ordinal) : maximum, Math.max(base + input.turns.length - 1, metadata.historyCoverageMaxOrdinal ?? -1));
    let nextMutableOrdinal = facts.reduce((maximum, row) => row.kind === "turn" && row.historyEpoch === input.historyEpoch
      ? Math.max(maximum, row.ordinal) : maximum, sealedMaximum) + 1;
    for (const row of facts) {
      if (row.kind !== "turn" || row.sealed || row.historyEpoch !== input.historyEpoch || row.turn?.status !== "inProgress"
        || row.remoteTurnId === null || ordinals.has(row.remoteTurnId) || row.ordinal > sealedMaximum) continue;
      // Mutable placement follows the known tail, but never proves adjacency to that tail.
      const ordinal = nextMutableOrdinal++;
      for (const family of facts) {
        if (family.remoteTurnId === row.remoteTurnId && family.historyEpoch === input.historyEpoch) {
          mutableRepositions.push({ ...family, ordinal });
        }
      }
    }
    if (!current()) return rejected();
    const scope = threadChatScope(input.connectionId, input.threadId);
    rangePersistenceScopes.add(scope);
    try {
      await commitThreadProjection({
        connectionId: input.connectionId,
        threadId: input.threadId,
        turns: input.turns,
        ordinals,
        historyEpoch: input.historyEpoch,
        authority: "authoritative",
        threadMeta: threadRow(input.connectionId, metadata.thread, metadata.sessionId, metadata.lastOpenedAt,
          input.historyEpoch, historyCursor, true, coverage.min, coverage.max, metadata.projectionCursor, input.sourceWitness,
          metadata.currentUsage ?? null, metadata.currentOutcome ?? null),
        durable: true,
        facts,
        mutableRepositions,
      });
    } finally {
      rangePersistenceScopes.delete(scope);
    }
    return { accepted: true, historyEpoch: input.historyEpoch };
  });

  const readStoredWindow = async (
    request: ThreadChatWindowRequest,
    requestedAt: number,
  ): Promise<ResolvedThreadDetailWindow> => {
    const resident = residentThreadWindow(
      request,
      source.rowsForThread(request.connectionId, request.threadId),
      chat.window$(request.connectionId, request.threadId).peek(),
    );
    if (resident !== null) return resident;
    const sqliteStartedAt = performance.now();
    const loaded = await detailStorage.loadResolvedWindow({
      connectionId: request.connectionId,
      threadId: request.threadId,
      anchorTurnId: request.anchorTurnId,
      turnLimit: THREAD_RESIDENT_TURN_LIMIT,
      newerBuffer: THREAD_HISTORY_PAGE_SIZE,
    });
    recordThreadOpeningMeasure(request.connectionId, request.threadId, "sqlite_read", performance.now() - sqliteStartedAt);
    recordThreadNavigationMeasure(
      request.connectionId,
      request.threadId,
      "chat_window_sqlite",
      performance.now() - sqliteStartedAt,
      {
        values: {
          elapsedMs: performance.now() - requestedAt,
          turnRows: loaded.turnRows.length,
          detailRows: loaded.detailRows.length,
          liveRows: loaded.liveRows.length,
        },
      },
    );
    return loaded;
  };

  const installStoredWindow = (
    request: ThreadChatWindowRequest,
    generation: number,
    loaded: ResolvedThreadDetailWindow,
    requestedAt: number,
    navigationId: string | null,
  ): boolean => {
    const persistedRows = [...loaded.turnRows, ...loaded.detailRows, ...loaded.liveRows];
    const rows = mergePendingTimelineOverlays(
      composeInitialRangeRows(
        source.rowsForThread(request.connectionId, request.threadId),
        persistedRows,
        loaded.historyEpoch,
      ),
      [...stagedPendingOverlays.values()],
      request.connectionId,
      request.threadId,
    );
    const membership = rangeMembership(rows, loaded.historyEpoch);
    const committed = chat.commitWindow(request, generation, {
      scope: threadChatScope(request.connectionId, request.threadId),
      requestKey: threadChatRequestKey(request),
      historyEpoch: loaded.historyEpoch,
      latestSealedOrdinal: loaded.latestSealedOrdinal,
      earliestSealedOrdinal: loaded.earliestSealedOrdinal,
      residentTurnLimit: THREAD_RESIDENT_TURN_LIMIT,
      ...membership,
      rows,
    });
    if (!committed) return false;
    source.replaceThreadLoaded(request.connectionId, request.threadId, rows);
    reportStorageDiagnostics(request.connectionId, request.threadId);
    recordThreadNavigationVisualEvent(request.connectionId, request.threadId, "chat_window_model_installed", {
      values: {
        totalLoadMs: performance.now() - requestedAt,
        turnRows: loaded.turnRows.length,
        detailRows: loaded.detailRows.length,
        liveRows: loaded.liveRows.length,
      },
    }, navigationId ?? undefined);
    return true;
  };

  const loadWindow = async (request: ThreadChatWindowRequest, navigationToken?: number): Promise<void> => {
    if (navigationToken !== undefined && !windowIntents.isCurrent(navigationToken)) return;
    const navigationId = activeThreadNavigationIdFor(request.connectionId, request.threadId);
    const requestedAt = performance.now();
    recordThreadNavigationVisualEvent(request.connectionId, request.threadId, "chat_window_load_requested", {
      values: { residentTurnLimit: THREAD_RESIDENT_TURN_LIMIT },
      tags: {
        source: navigationToken === undefined ? "render" : "press_preload",
        anchor: request.anchorTurnId === null ? "tail" : "saved",
      },
    }, navigationId ?? undefined);
    const generation = chat.startWindow(request);
    let cachedWindow: ResolvedThreadDetailWindow | null = null;
    let hadUsableCachedThread = false;
    let installedResidentWindow: ResolvedThreadDetailWindow | null = null;
    const installAndReconcilePending = async (loaded: ResolvedThreadDetailWindow): Promise<void> => {
      const installed = loaded === installedResidentWindow || await writes.run(async () => {
        if (navigationToken !== undefined && !windowIntents.isCurrent(navigationToken)) return false;
        return installStoredWindow(request, generation, loaded, requestedAt, navigationId);
      });
      if (!installed || remoteLoader === null) return;
      // SQLite mirrors the visible delivery row while Kotlin's native outbox
      // remains the recovery authority. Reconcile every activation so a failed
      // command and its retry state advance even after the app slept.
      await remoteLoader.reconcilePending({
        connectionId: request.connectionId,
        threadId: request.threadId,
      });
    };
    try {
      // Source transactions publish synchronously before awaiting durability.
      // A proven resident range can therefore be read and installed in one JS
      // turn without waiting for another chat's SQLite checkpoint. Keep disk
      // reads in the writer lane so they cannot install a stale partial write.
      const resident = residentThreadWindow(
        request,
        source.rowsForThread(request.connectionId, request.threadId),
        chat.window$(request.connectionId, request.threadId).peek(),
      );
      if (resident !== null) {
        if (navigationToken !== undefined && !windowIntents.isCurrent(navigationToken)) return;
        if (!installStoredWindow(request, generation, resident, requestedAt, navigationId)) return;
        installedResidentWindow = resident;
        cachedWindow = resident;
        recordThreadOpeningMeasure(request.connectionId, request.threadId, "queue_wait", 0);
      } else cachedWindow = await writes.run(async () => {
        const laneEnteredAt = performance.now();
        recordThreadOpeningMeasure(request.connectionId, request.threadId, "queue_wait", laneEnteredAt - requestedAt);
        recordThreadNavigationMeasure(
          request.connectionId,
          request.threadId,
          "chat_window_write_lane_wait",
          laneEnteredAt - requestedAt,
        );
        // Superseded press intents that have not reached SQLite are skipped
        // instead of making the selected destination wait behind useless work.
        if (navigationToken !== undefined && !windowIntents.isCurrent(navigationToken)) return null;
        return await readStoredWindow(request, requestedAt);
      });
      if (cachedWindow === null) return;

      recordThreadOpeningMeasure(request.connectionId, request.threadId, "cache_read", performance.now() - requestedAt);

      const cachedRows = [...cachedWindow.turnRows, ...cachedWindow.detailRows, ...cachedWindow.liveRows];
      const materializedCache = materializeThreadDetail(
        cachedRows,
        request.connectionId,
        request.threadId,
        sessionId,
      )?.thread ?? null;
      const coverage = threadWindowCoverage(request, cachedWindow);
      // Metadata without its proven history is a cache miss, not an empty chat.
      const cachedThread = materializedCache !== null && (materializedCache.turns.length > 0 || coverage.complete)
        ? materializedCache : null;
      hadUsableCachedThread = cachedThread !== null;
      // Observing only attaches future live events. Every newly opened window
      // therefore performs one bounded head read after revealing SQLite, even
      // when the local coverage itself is complete: the thread may have moved
      // while another chat was observed or while this client was offline.
      const activationRefresh = coverage.complete && cachedThread !== null;
      const requiresHydration = !coverage.complete || cachedThread === null;
      if ((activationRefresh || requiresHydration) && remoteLoader !== null) {
        const loader = remoteLoader;
        const hydrateAndInstall = async (): Promise<void> => {
          const hydrateStartedAt = performance.now();
          const finishBackendRefresh = chat.beginBackendRefresh(request.connectionId, request.threadId);
          try {
            await loader.hydrateWindow({
              request,
              cachedThread,
              requireAuthoritative: true,
              reason: activationRefresh ? "activation" : coverage.reason,
            });
            if (navigationToken !== undefined && !windowIntents.isCurrent(navigationToken)) return;
            const refreshedWindow = await writes.run(async () => await readStoredWindow(request, requestedAt));
            const refreshedCoverage = threadWindowCoverage(request, refreshedWindow);
            const refreshedTurnCount = [...refreshedWindow.turnRows, ...refreshedWindow.liveRows]
              .filter((row) => row.kind === "turn").length;
            if (!refreshedCoverage.complete && refreshedTurnCount === 0) {
              recordThreadHistoryTelemetry(request.connectionId, request.threadId, "chat.history.empty_hydration_rejected", {
                tags: { reason: refreshedCoverage.reason },
              });
              throw new Error(`Authoritative thread hydration left no readable turns (${refreshedCoverage.reason})`);
            }
            await installAndReconcilePending(refreshedWindow);
          } finally {
            recordThreadOpeningMeasure(request.connectionId, request.threadId, "hydrate", performance.now() - hydrateStartedAt);
            finishBackendRefresh();
          }
        };

        if (cachedThread !== null) {
          // A materializable SQLite window is immediately usable even when its
          // coverage cursor says that an authoritative repair is desirable.
          // Resolve the navigation resource from local data; the background
          // cursor sync must never hold an already-cached chat behind network
          // recovery.
          await installAndReconcilePending(cachedWindow as ResolvedThreadDetailWindow);
          void hydrateAndInstall().catch((cause: unknown) => {
            console.warn("CodeWide background thread repair failed:", cause instanceof Error ? cause.message : "unknown error");
          });
          return;
        }

        // A true local miss keeps the transcript loading until the backend
        // window is durably written and installed; surrounding controls are usable.
        await hydrateAndInstall();
        return;
      }

      await installAndReconcilePending(cachedWindow as ResolvedThreadDetailWindow);
    } catch (cause) {
      if (navigationToken !== undefined && !windowIntents.isCurrent(navigationToken)) return;
      if (cachedWindow !== null && hadUsableCachedThread) {
        await installAndReconcilePending(cachedWindow as ResolvedThreadDetailWindow);
        return;
      }
      chat.failWindow(request, generation, cause);
      throw cause;
    } finally {
      recordThreadOpeningMeasure(request.connectionId, request.threadId, "open", performance.now() - requestedAt);
    }
  };

  const database: ThreadDetailDatabase = {
    sessionId,
    chat,
    async prepare() {
      await detailStorage.prepare();
    },
    setRemoteLoader(loader) {
      remoteLoader = loader;
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
      // Retention is the model-owned subscription boundary. Unlike tap or
      // press-in, it also runs when the app restores directly into an already
      // open conversation after a process or OTA restart.
      remoteLoader?.observe?.({ connectionId, threadId });
      return release;
    },
    adoptPreloadedWindow(connectionId, threadId) {
      windowIntents.adopt(threadChatScope(connectionId, threadId));
    },
    async loadWindow(request) {
      await loadWindow(request);
    },
    async pullRange(connectionId, threadId, direction) {
      const scope = threadChatScope(connectionId, threadId);
      const pullKey = `${scope}\u0000${direction}`;
      const existing = rangePulls.get(pullKey);
      if (existing !== undefined) {
        recordThreadHistoryTelemetry(connectionId, threadId, "chat.history.range_pull_coalesced", {
          tags: { direction },
        });
        return await existing;
      }
      const operationStartedAt = performance.now();
      recordThreadHistoryTelemetry(connectionId, threadId, "chat.history.range_pull_started", {
        tags: { direction },
      });
      let noOpReason = "none";
      let residentTurnCount = 0;
      let newerAfterTurnId: string | null = null;
      let olderBeforeTurnId: string | null = null;
      const initialWindow = chat.window$(connectionId, threadId).peek();
      const pullStoredRange = async (): Promise<boolean> => await writes.run(async () => {
        if (disposed) {
          noOpReason = "disposed";
          return false;
        }
        const snapshot = chat.window$(connectionId, threadId).peek();
        if (!threadLoadHasResidentSnapshot(snapshot.status)) {
          noOpReason = "snapshot_not_resident";
          return false;
        }
        const residentTurns = chat.readRows(snapshot.turnRowIds)
          .filter((row) => row.kind === "turn" && row.sealed && row.historyEpoch === snapshot.historyEpoch);
        residentTurnCount = residentTurns.length;
        if (residentTurns.length === 0 && direction !== "latest") {
          noOpReason = "resident_range_empty";
          return false;
        }
        const residentMinimum = residentTurns.reduce<number | null>(
          (minimum, row) => minimum === null ? row.ordinal : Math.min(minimum, row.ordinal),
          null,
        );
        const residentMaximum = residentTurns.reduce<number | null>(
          (maximum, row) => maximum === null ? row.ordinal : Math.max(maximum, row.ordinal),
          null,
        );
        const sqliteStartedAt = performance.now();
        let latestSealedOrdinal = snapshot.latestSealedOrdinal;
        let earliestSealedOrdinal = snapshot.earliestSealedOrdinal;
        let loaded;
        if (direction === "latest") {
          loaded = await detailStorage.loadResolvedWindow({
            connectionId,
            threadId,
            anchorTurnId: null,
            turnLimit: THREAD_RESIDENT_TURN_LIMIT,
            newerBuffer: THREAD_HISTORY_PAGE_SIZE,
          });
          latestSealedOrdinal = loaded.latestSealedOrdinal;
          earliestSealedOrdinal = loaded.earliestSealedOrdinal;
        } else {
          const boundaryOrdinal = direction === "older" ? residentMinimum : residentMaximum;
          if (boundaryOrdinal === null) {
            noOpReason = "resident_boundary_missing";
            return false;
          }
          loaded = await detailStorage.loadAdjacentWindow({
            connectionId,
            threadId,
            historyEpoch: snapshot.historyEpoch,
            boundaryOrdinal,
            direction,
            turnLimit: THREAD_HISTORY_PAGE_SIZE,
          });
          const boundaryTurnId = residentTurns.find((row) => row.ordinal === boundaryOrdinal)?.remoteTurnId ?? null;
          if (direction === "older") olderBeforeTurnId = boundaryTurnId;
          else newerAfterTurnId = boundaryTurnId;
          const contiguous = contiguousHistoryPage(loaded.turnRows, boundaryOrdinal, direction);
          const selectedIds = new Set(contiguous.map((row) => row.remoteTurnId));
          const gap = contiguous.length !== loaded.turnRows.length;
          loaded = { turnRows: contiguous,
            detailRows: loaded.detailRows.filter((row) => selectedIds.has(row.remoteTurnId)),
            liveRows: loaded.liveRows };
          if (loaded.turnRows.length === 0) {
            noOpReason = `${direction}_${gap ? "gap" : "boundary"}`;
            return false;
          }
        }
        recordThreadHistoryTelemetry(connectionId, threadId, "chat.history.range_sqlite_loaded", {
          values: {
            durationMs: performance.now() - sqliteStartedAt,
            turnRows: loaded.turnRows.length,
            detailRows: loaded.detailRows.length,
            liveRows: loaded.liveRows.length,
          },
          tags: { direction },
        });
        const persistedRows = [...loaded.turnRows, ...loaded.detailRows, ...loaded.liveRows];
        const expandedRows = composeExpandedRangeRows(
          chat.readRows([...snapshot.turnRowIds, ...snapshot.detailRowIds, ...snapshot.liveRowIds])
            .map((row) => source.get(row.id) ?? row),
          persistedRows,
          snapshot.historyEpoch,
        );
        const rows = mergePendingTimelineOverlays(
          direction === "latest"
            ? trimExpandedRangeRows(expandedRows, snapshot.historyEpoch, "newer", THREAD_RESIDENT_TURN_LIMIT)
            : expandedRows,
          [...stagedPendingOverlays.values()],
          connectionId,
          threadId,
        );
        const membership = rangeMembership(rows, snapshot.historyEpoch);
        const committed = chat.commitRange(connectionId, threadId, {
          historyEpoch: snapshot.historyEpoch,
          layoutRevision: snapshot.layoutRevision,
        }, {
          scope,
          requestKey: snapshot.requestKey,
          historyEpoch: snapshot.historyEpoch,
          latestSealedOrdinal,
          earliestSealedOrdinal,
          residentTurnLimit: THREAD_RESIDENT_TURN_LIMIT,
          ...membership,
          rows,
        });
        if (!committed) {
          noOpReason = "stale_commit";
          return false;
        }
        source.replaceThreadLoaded(connectionId, threadId, rows);
        return true;
      });
      const operation = (async (): Promise<boolean> => {
        const local = await pullStoredRange();
        if (local || remoteLoader === null) return local;
        const historyEpoch = source.historyEpoch(connectionId, threadId);
        const exhaustionScope = `${scope}\u0000${historyEpoch}`;
        const exhaustionRevision = historyExhaustionRevision;
        if (direction === "older" && (noOpReason === "older_boundary" || noOpReason === "older_gap")
          && olderBeforeTurnId !== null && remoteLoader.loadBefore !== undefined) {
          if (olderExhaustedTurnIdByThread.get(exhaustionScope) === olderBeforeTurnId) return false;
          const result = await remoteLoader.loadBefore({ connectionId, threadId, beforeTurnId: olderBeforeTurnId, historyEpoch });
          if (result.status === "persisted" && !result.hasMore && exhaustionRevision === historyExhaustionRevision
            && source.historyEpoch(connectionId, threadId) === historyEpoch) {
            olderExhaustedTurnIdByThread.set(exhaustionScope, result.oldestTurnId);
          }
        } else if (direction === "older" && noOpReason === "older_boundary") {
          const cursor = source.historyCursor(connectionId, threadId);
          if (typeof cursor !== "string") return false;
          await remoteLoader.loadOlder({ connectionId, threadId, cursor, historyEpoch });
        } else if (direction === "newer"
          && (noOpReason === "newer_boundary" || noOpReason === "newer_gap")
          && newerAfterTurnId !== null) {
          if (newerExhaustedTurnIdByThread.get(exhaustionScope) === newerAfterTurnId) return false;
          const result = await remoteLoader.loadNewer({
            connectionId,
            threadId,
            afterTurnId: newerAfterTurnId,
            historyEpoch,
          });
          if (result.status === "persisted" && !result.hasMore && exhaustionRevision === historyExhaustionRevision
            && source.historyEpoch(connectionId, threadId) === historyEpoch) {
            newerExhaustedTurnIdByThread.set(exhaustionScope, result.lastTurnId);
          }
        } else {
          return false;
        }
        noOpReason = "none";
        const currentWindow = chat.window$(connectionId, threadId).peek();
        if (currentWindow.historyEpoch !== initialWindow.historyEpoch || currentWindow.requestKey !== initialWindow.requestKey) return false;
        const extended = await pullStoredRange();
        return extended || !sameStringSequence(initialWindow.turnRowIds, chat.window$(connectionId, threadId).peek().turnRowIds);
      })();
      rangePulls.set(pullKey, operation);
      try {
        const pulled = await operation;
        recordThreadHistoryTelemetry(connectionId, threadId, "chat.history.range_pull_finished", {
          values: {
            durationMs: performance.now() - operationStartedAt,
            residentTurnCount,
          },
          tags: { direction, outcome: pulled ? "pulled" : "ignored", reason: pulled ? "none" : noOpReason },
        });
        return pulled;
      } catch (cause) {
        recordThreadHistoryTelemetry(connectionId, threadId, "chat.history.range_pull_failed", {
          values: { durationMs: performance.now() - operationStartedAt },
          tags: { direction, errorKind: telemetryErrorKind(cause) },
        });
        throw cause;
      } finally {
        if (rangePulls.get(pullKey) === operation) rangePulls.delete(pullKey);
      }
    },
    async trimRange(connectionId, threadId, direction) {
      return await writes.run(async () => {
        if (disposed) return false;
        const snapshot = chat.window$(connectionId, threadId).peek();
        if (!threadLoadHasResidentSnapshot(snapshot.status)) return false;
        const residentRows = source.rowsForThread(connectionId, threadId);
        const rows = trimExpandedRangeRows(
          residentRows,
          snapshot.historyEpoch,
          direction,
          THREAD_RESIDENT_TURN_LIMIT,
        );
        if (rows.length === residentRows.length) return false;
        const membership = rangeMembership(rows, snapshot.historyEpoch);
        const committed = chat.commitRange(connectionId, threadId, {
          historyEpoch: snapshot.historyEpoch,
          layoutRevision: snapshot.layoutRevision,
        }, {
          scope: threadChatScope(connectionId, threadId),
          requestKey: snapshot.requestKey,
          historyEpoch: snapshot.historyEpoch,
          latestSealedOrdinal: snapshot.latestSealedOrdinal,
          earliestSealedOrdinal: snapshot.earliestSealedOrdinal,
          residentTurnLimit: THREAD_RESIDENT_TURN_LIMIT,
          ...membership,
          rows,
        });
        if (!committed) return false;
        source.replaceThreadLoaded(connectionId, threadId, rows);
        recordThreadHistoryTelemetry(connectionId, threadId, "chat.history.range_trimmed", {
          values: {
            beforeTurnCount: snapshot.turnRowIds.length,
            afterTurnCount: membership.turnRowIds.length,
          },
          tags: { direction },
        });
        return true;
      });
    },
    readWindowRows(snapshot) {
      return {
        turnRows: chat.readRows(snapshot.turnRowIds),
        detailRows: chat.readRows(snapshot.detailRowIds),
        liveRows: chat.readRows(snapshot.liveRowIds),
      };
    },
    windowCoverage(request, snapshot) {
      return threadWindowCoverage(request, database.readWindowRows(snapshot));
    },
    async applySnapshot(connectionId, snapshots, _cursor) {
      await confirmCommandReceipts(connectionId, snapshots.flatMap(({ thread }) =>
        thread.turns.flatMap((turn) => commandReceiptsFromTurn(thread.id, turn))));
      await writes.run(async () => {
        if (disposed) return;
        const byId = new Map(snapshots.map((snapshot) => [snapshot.thread.id, snapshot]));
        await runWriteTransaction((controls) => {
          let mutationCount = 0;
          for (const row of source.threadMetaRows(connectionId)) {
            const snapshot = byId.get(row.remoteThreadId);
            if (snapshot === undefined || row.thread === null) continue;
            // Snapshot list updates only bounded thread metadata. Turn metadata is
            // stored in independent rows and lifecycle belongs exclusively to
            // the detail stream. The list may update presentation fields only.
            const metadata = mergeThreadPresentationMetadata(row.thread, snapshot.thread);
            const next = threadRow(
              connectionId,
              metadata,
              row.sessionId,
              row.lastOpenedAt,
              row.historyEpoch,
              row.historyCursor,
              row.historyHadTurns === true
                || source.rowsForThread(connectionId, row.remoteThreadId).some((candidate) => candidate.kind === "turn")
                ? true
                : row.historyHadTurns,
              row.historyCoverageMinOrdinal,
              row.historyCoverageMaxOrdinal,
              row.projectionCursor,
              row.historySourceWitness,
              row.currentUsage ?? null,
              row.currentOutcome ?? null,
            );
            if (writeOwnedRow(controls, next.id, next)) mutationCount += 1;
          }
          return { value: undefined, durable: mutationCount > 0 };
        });
      });
    },
    async applyEvents(connectionId, events) {
      if (disposed || events.length === 0) {
        return { checkpoint: Promise.resolve(), threads: new Map() };
      }
      const semanticEvents = events.flatMap((event) => {
        const patch = threadProjectionPatchFromEvent(event.payload);
        return patch === null ? [] : [{ cursor: event.cursor, patch }];
      });
      // Command evidence belongs to durable delivery, not the optional UI cache.
      // Complete this checkpoint before the native stream can acknowledge its cursor.
      await confirmCommandReceipts(connectionId, semanticEvents.flatMap(({ patch }) =>
        commandReceiptsFromOperation(patch.threadId, patch.operation)));
      const pendingSnapshots = new Set(semanticEvents.flatMap(({ patch }) => {
        const pending = projectionSnapshots.get(threadScope(connectionId, patch.threadId));
        return pending === undefined ? [] : [pending.promise];
      }));
      await Promise.all(pendingSnapshots);
      const projectionPatchesAfterSnapshot = (): ThreadProjectionPatchV1[] => semanticEvents.flatMap(({ cursor, patch }) => {
        const metadata = source.get(threadMetaKey(connectionId, patch.threadId));
        return metadata?.kind === "thread"
          && metadata.projectionCursor !== undefined
          && cursor <= metadata.projectionCursor
          ? []
          : [patch];
      });
      let semanticPatches = await writes.run(async () => projectionPatchesAfterSnapshot());
      const repairs = await writes.run(async () => {
        const repairPatchesByThread = new Map<string, ThreadProjectionPatchV1[]>();
        for (const patch of semanticPatches) {
          if (!source.has(threadMetaKey(connectionId, patch.threadId))) continue;
          const patches = repairPatchesByThread.get(patch.threadId) ?? [];
          patches.push(patch);
          repairPatchesByThread.set(patch.threadId, patches);
        }
        const required: string[] = [];
        for (const [threadId, patches] of repairPatchesByThread) {
          const current = materializeThreadDetail(
            source.liveRows(connectionId, threadId, patches),
            connectionId,
            threadId,
            sessionId,
          );
          if (current !== null
            && threadProjectionNeedsAuthoritativeRepair(current.thread, patches)
            && (remoteLoader?.shouldRepairProjection?.({ connectionId, threadId }) ?? true)) {
            required.push(threadId);
          }
        }
        return required;
      });
      if (repairs.length > 0) {
        const loader = remoteLoader;
        if (loader === null) throw new Error("Thread projection repair requires a remote loader");
        for (const threadId of repairs) {
          await loader.repairProjection({ connectionId, threadId });
        }
        const repairedThreadIds = new Set(repairs);
        semanticPatches = await writes.run(async () => projectionPatchesAfterSnapshot());
        await writes.run(async () => {
          const patchesByThread = new Map<string, ThreadProjectionPatchV1[]>();
          for (const patch of semanticPatches) {
            if (!source.has(threadMetaKey(connectionId, patch.threadId))) continue;
            const patches = patchesByThread.get(patch.threadId) ?? [];
            patches.push(patch);
            patchesByThread.set(patch.threadId, patches);
          }
          for (const [threadId, patches] of patchesByThread) {
            if (!repairedThreadIds.has(threadId)) continue;
            const current = materializeThreadDetail(
              source.liveRows(connectionId, threadId, patches),
              connectionId,
              threadId,
              sessionId,
            );
            if (current !== null && threadProjectionNeedsAuthoritativeRepair(current.thread, patches)) {
              throw new Error(`Authoritative thread snapshot did not cover projection gap for ${threadId}`);
            }
          }
        });
      }
      const startedThreadIds = new Set(semanticPatches.flatMap((patch) => {
        const threadId = patch.threadId;
        return startedThreadShells.has(threadScope(connectionId, threadId))
          ? [threadId]
          : [];
      }));
      return await writes.run(async () => {
        if (disposed) throw new Error("Thread detail database is closed");
        const checkpoints: Promise<void>[] = [];
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
        const byThread = new Map<string, ThreadProjectionPatchV1[]>();
        for (const patch of semanticPatches) {
          if (!source.has(threadMetaKey(connectionId, patch.threadId))) continue;
          if (patch.operation.kind === "threadDeleted") {
            await deleteThreadRows(source, controls, connectionId, patch.threadId);
            advanceLiveRevision(connectionId, patch.threadId);
            continue;
          }
          const patches = byThread.get(patch.threadId) ?? [];
          patches.push(patch);
          byThread.set(patch.threadId, patches);
        }
        for (const [threadId, patches] of byThread) {
          const slice = source.liveRows(connectionId, threadId, patches);
          const current = materializeThreadDetail(slice, connectionId, threadId, sessionId);
          if (current === null) continue;
          const next = applyThreadProjectionPatchesImmutable(current.thread, patches);
          projectedThreads.set(threadId, { before: current.thread, after: next });
          if (next !== current.thread) {
            let startedTurnId: string | null = null;
            for (const { operation } of patches) {
              const value = operation.turn;
              if (operation.kind === "turnStarted" && typeof value === "object" && value !== null
                && "id" in value && typeof value.id === "string") startedTurnId = value.id;
            }
            checkpoints.push(publishLiveSlice(connectionId, next, startedTurnId));
            advanceLiveRevision(connectionId, threadId);
          }
        }
        for (const patch of semanticPatches) {
          if (projectionOperationClosesStartedShell(patch.operation.kind)) {
            startedThreadShells.delete(threadScope(connectionId, patch.threadId));
          }
        }
        return {
          checkpoint: Promise.all(checkpoints).then(() => undefined),
          threads: projectedThreads,
        };
      });
    },
    liveRevision,
    historyCursor(connectionId, threadId) {
      return source.historyCursor(connectionId, threadId);
    },
    historySourceWitness(connectionId, threadId) {
      return source.get(threadMetaKey(connectionId, threadId))?.historySourceWitness;
    },
    async latestSealedTurnId(connectionId, threadId) {
      const meta = await detailStorage.loadThreadMeta(connectionId, threadId);
      if (meta?.kind !== "thread") return null;
      const latest = await detailStorage.loadBoundary(connectionId, threadId, meta.historyEpoch, "desc");
      return latest?.kind === "turn" && latest.sealed ? latest.remoteTurnId : null;
    },
    beginProjectionSnapshot(connectionId, threadId) {
      const scope = threadScope(connectionId, threadId);
      if (projectionSnapshots.has(scope)) {
        throw new Error(`Thread projection snapshot already active for ${threadId}`);
      }
      let resolve = (): void => undefined;
      const promise = new Promise<void>((settle) => { resolve = settle; });
      projectionSnapshots.set(scope, { promise, resolve });
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        const snapshot = projectionSnapshots.get(scope);
        if (snapshot?.promise !== promise) return;
        projectionSnapshots.delete(scope);
        snapshot.resolve();
      };
    },
    async synchronizeThread(input) {
      await writes.run(async () => {
        const snapshotActive = projectionSnapshots.has(threadScope(input.connectionId, input.thread.id));
        const preserveConcurrentHead = !snapshotActive
          && liveRevision(input.connectionId, input.thread.id) !== input.expectedLiveRevision;
        await publishThread(
          input.connectionId,
          input.thread,
          input.mode === "reset" ? "reset" : "authoritative",
          Date.now(),
          preserveConcurrentHead,
          input.historyCursor,
          input.throughCursor,
          input.sourceWitness,
          input.isCurrent,
        );
      });
    },
    async importThreadSnapshot(connectionId, thread, _reason, historyCursor) {
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
        await publishThread(connectionId, thread, "authoritative", Date.now(), false, historyCursor);
      });
    },
    async replaceThreadSnapshot(connectionId, thread, _reason, historyCursor) {
      await writes.run(async () => {
        await publishThread(connectionId, thread, "reset", Date.now(), false, historyCursor);
      });
    },
    async mergeTailTurns(connectionId, threadId, turns, historyCursor, isCurrent = () => true) {
      await writes.run(async () => {
        if (!isCurrent()) return;
        const current = materializeThreadDetail(
          source.rowsForThread(connectionId, threadId),
          connectionId,
          threadId,
          sessionId,
        );
        if (current === null) throw new Error(`Cannot merge a tail page before thread ${threadId} is hydrated`);
        // A canonical tail replaces the active traversal boundary, not the
        // sparse cache. Stable turn ids reconcile overlaps while disconnected
        // cached islands stay durable for later cursor traversal.
        await publishThread(
          connectionId,
          { ...current.thread, turns },
          "tail",
          Date.now(),
          true,
          historyCursor,
          undefined,
          undefined,
          isCurrent,
        );
      });
    },
    async appendTurns(connectionId, threadId, turns, historyCursor) {
      return await writes.run(async () => {
        const currentRows = source.rowsForThread(connectionId, threadId);
        const current = materializeThreadDetail(currentRows, connectionId, threadId, sessionId);
        if (current === null) return { accepted: false, historyEpoch: source.historyEpoch(connectionId, threadId) };
        if (turns.length > 0) {
          // Only the supplied canonical suffix participates. Existing sealed
          // rows are never replaced as a collection; overlapping live/final
          // turns are reconciled by stable turn id and all new rows append
          // after the durable maximum ordinal.
          await publishThread(connectionId, { ...current.thread, turns }, "append", Date.now(), false, historyCursor);
        }
        return { accepted: true, historyEpoch: source.historyEpoch(connectionId, threadId) };
      });
    },
    async appendTurnsAfter(connectionId, threadId, expectedHistoryEpoch, afterTurnId, turns, sourceWitness, isCurrent, requestedSourceWitness) {
      return await persistAnchoredPage({ connectionId, threadId, historyEpoch: expectedHistoryEpoch,
        anchorTurnId: afterTurnId, turns, sourceWitness, requestedSourceWitness, isCurrent, direction: "newer" });
    },
    async prependTurnsBefore(connectionId, threadId, expectedHistoryEpoch, beforeTurnId, turns, hasMore, sourceWitness, isCurrent, requestedSourceWitness) {
      return await persistAnchoredPage({ connectionId, threadId, historyEpoch: expectedHistoryEpoch,
        anchorTurnId: beforeTurnId, turns, sourceWitness, requestedSourceWitness, isCurrent, direction: "older", hasMore });
    },
    invalidateHistoryExhaustion,
    async replaceActiveThread(connectionId, thread) {
      await writes.run(async () => await publishLiveSlice(connectionId, thread));
    },
    async prependTurns(connectionId, threadId, expectedHistoryEpoch, turns, nextCursor, isCurrent = () => true) {
      const startedAt = performance.now();
      recordThreadHistoryTelemetry(connectionId, threadId, "chat.history.prepend_started", {
        values: { expectedHistoryEpoch, turnCount: turns.length },
        tags: { nextCursor: nextCursor === null ? "exhausted" : "available" },
      });
      try {
        const result = await writes.run(async () => {
        const historyEpoch = source.historyEpoch(connectionId, threadId);
        if (historyEpoch !== expectedHistoryEpoch || !isCurrent()) return { accepted: false, historyEpoch, extendedMinimum: false };
        if (disposed) throw new Error("Thread detail database is closed");
        const before = chat.window$(connectionId, threadId).peek();
        const beforeTurnRowIds = before.turnRowIds;
        const facts = await loadDurablePrependRows(connectionId, threadId, historyEpoch, turns.map((turn) => turn.id));
        if (!isCurrent() || disposed || source.historyEpoch(connectionId, threadId) !== historyEpoch) {
          return { accepted: false, historyEpoch: source.historyEpoch(connectionId, threadId), extendedMinimum: false };
        }
        const prependedOrdinals = projectPrependedTurnOrdinals(
          mergeHistoryFacts(facts, source.rowsForThread(connectionId, threadId)),
          historyEpoch,
          turns.map((turn) => turn.id),
        );
        const metadata = source.get(threadMetaKey(connectionId, threadId));
        const prependedCoverage = extendAuthoritativeCoverage(metadata, turns, prependedOrdinals);
        await commitThreadProjection({
          connectionId,
          threadId,
          turns,
          ordinals: prependedOrdinals,
          historyEpoch,
          authority: "authoritative",
          ...(metadata?.kind === "thread" && metadata.thread !== null
            ? { threadMeta: threadRow(
                connectionId,
                metadata.thread,
                metadata.sessionId,
                metadata.lastOpenedAt,
                historyEpoch,
                nextCursor,
                metadata.historyHadTurns === true || turns.length > 0,
                prependedCoverage.min,
                prependedCoverage.max,
                metadata.projectionCursor,
                metadata.historySourceWitness,
                metadata.currentUsage ?? null,
                metadata.currentOutcome ?? null,
              ) }
            : {}),
          ...(metadata?.kind === "thread" ? {} : { historyCursor: { value: nextCursor } }),
          durable: true,
          facts,
        });
        // Persistence and presentation meet here. The remote page is already
        // in SQLite; publish one atomic Legend range without trimming the
        // opposite edge while the list is still moving.
        const current = chat.window$(connectionId, threadId).peek();
        const rows = composeExpandedRangeRows(
          source.rowsForThread(connectionId, threadId),
          [],
          historyEpoch,
        );
        const membership = rangeMembership(rows, historyEpoch);
        const changedRange = !sameStringSequence(beforeTurnRowIds, membership.turnRowIds);
        let publishedRange = false;
        if (changedRange) {
          const minimum = rows.reduce<number | null>((value, row) => (
            row.kind !== "turn" || !row.sealed || row.historyEpoch !== historyEpoch
              ? value
              : value === null ? row.ordinal : Math.min(value, row.ordinal)
          ), null);
          const committed = chat.commitRange(connectionId, threadId, {
            historyEpoch,
            layoutRevision: current.layoutRevision,
          }, {
            scope: threadChatScope(connectionId, threadId),
            requestKey: current.requestKey,
            historyEpoch,
            latestSealedOrdinal: current.latestSealedOrdinal,
            earliestSealedOrdinal: minimumNullable(current.earliestSealedOrdinal, minimum),
            residentTurnLimit: THREAD_RESIDENT_TURN_LIMIT,
            ...membership,
            rows,
          });
          if (committed) {
            source.replaceThreadLoaded(connectionId, threadId, rows);
            publishedRange = true;
          }
        }
        return {
          accepted: true,
          historyEpoch,
          extendedMinimum: publishedRange,
        };
        });
        recordThreadHistoryTelemetry(connectionId, threadId, "chat.history.prepend_finished", {
          values: {
            durationMs: performance.now() - startedAt,
            expectedHistoryEpoch,
            actualHistoryEpoch: result.historyEpoch,
            turnCount: turns.length,
          },
          tags: {
            accepted: result.accepted ? "true" : "false",
            extendedMinimum: result.extendedMinimum ? "true" : "false",
            nextCursor: nextCursor === null ? "exhausted" : "available",
          },
        });
        return result;
      } catch (cause) {
        recordThreadHistoryTelemetry(connectionId, threadId, "chat.history.prepend_failed", {
          values: { durationMs: performance.now() - startedAt, expectedHistoryEpoch, turnCount: turns.length },
          tags: { errorKind: telemetryErrorKind(cause) },
        });
        throw cause;
      }
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
        await runWriteTransaction((controls) => {
          const changed = writeOwnedRow(controls, row.id, row);
          return { value: undefined, durable: changed };
        });
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
        if (row?.kind !== "pending" || row.pending?.confirmation !== undefined) continue;
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
            if (source.get(key)?.pending?.confirmation !== undefined) continue;
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
          && delivery.state !== "delivered"
          ? [delivery.commandId]
          : []
      )));
      // A delivered native row is a bounded receipt, not a deletion signal.
      // It keeps an existing optimistic bubble pending until the canonical
      // server turn takes over the same stable client-id key. Missing delivered
      // rows are never reconstructed from historical native receipts; the
      // durable SQLite mirror owns a currently visible accepted message.
      const retainedCommandIds = new Set(deliveries.flatMap((delivery) => (
        delivery.connectionId === connectionId
          && delivery.threadId === threadId
          && (delivery.method === "turn/start" || delivery.method === "turn/steer")
          ? [delivery.commandId]
          : []
      )));
      // The synchronous optimistic insert happens immediately before the
      // native durable enqueue. A concurrent authoritative refresh can inspect
      // the ledger during that tiny gap; include those staged command ids in
      // reconciliation diagnostics until enqueue either accepts or rolls back.
      for (const overlay of stagedPendingOverlays.values()) {
        const pending = overlay.row?.kind === "pending" ? overlay.row.pending : null;
        if (overlay.connectionId === connectionId
          && overlay.threadId === threadId
          && pending?.presentation === "delivery") {
          activeCommandIds.add(pending.commandId);
          retainedCommandIds.add(pending.commandId);
        }
      }
      for (const delivery of deliveries) {
        if (delivery.connectionId !== connectionId) continue;
        if (delivery.threadId !== threadId && source.pendingRow(connectionId, delivery.targetCommandId ?? "") === undefined) continue;
        await applyCommandDelivery(delivery, true);
      }
      const projectedRows = source.rowsForThread(connectionId, threadId);
      const reconciliation = pendingDeliveryReconciliationDiagnostics(
        projectedRows,
        retainedCommandIds,
      );
      const cleanup = planPendingDeliveryProjectionCleanup(projectedRows, retainedCommandIds);
      if (cleanup.deletes.length > 0) await persistPendingMutation(cleanup, true);
      if (reconciliation.pendingDeliveryCount > 0 || cleanup.deletes.length > 0) {
        recordThreadHistoryTelemetry(connectionId, threadId, "chat.optimistic.reconciliation", {
          values: {
            activeCommandCount: activeCommandIds.size,
            pendingDeliveryCount: reconciliation.pendingDeliveryCount,
            inactiveDeliveryCount: reconciliation.inactiveDeliveryCount,
            cleanedDeliveryCount: cleanup.deletes.length,
            stalledDeliveryCount: reconciliation.stalledCommandIds.length,
            oldestInactiveAgeMs: reconciliation.oldestInactiveAgeMs,
          },
          tags: {
            outcome: reconciliation.stalledCommandIds.length > 0
              ? "stalled"
              : reconciliation.pendingDeliveryCount > 0 ? "pending" : "settled",
          },
        });
      }
      const scope = threadScope(connectionId, threadId);
      const stalledFingerprint = reconciliation.stalledCommandIds.slice().sort().join("\u0000");
      if (stalledFingerprint === "") {
        reportedStalledOptimisticFingerprintByThread.delete(scope);
      } else if (reportedStalledOptimisticFingerprintByThread.get(scope) !== stalledFingerprint) {
        reportedStalledOptimisticFingerprintByThread.set(scope, stalledFingerprint);
        recordThreadHistoryTelemetry(connectionId, threadId, "chat.optimistic.reconciliation_stalled", {
          values: {
            stalledDeliveryCount: reconciliation.stalledCommandIds.length,
            oldestInactiveAgeMs: reconciliation.oldestInactiveAgeMs,
            activeCommandCount: activeCommandIds.size,
          },
          tags: { authoritativeMatch: "missing" },
        });
      }
    },
    async replaceQueued(connectionId, threadId, commands, preserveCommandIds = new Set()) {
      const incoming = new Map(commands
        .filter((command) => command.remoteThreadId === threadId)
        .flatMap((command) => {
          const existing = source.pendingRow(connectionId, command.commandId)?.pending;
          // Non-terminal receipts may advance an optimistic row created by
          // this app, but must never reconstruct historical direct messages.
          if (command.presentation === "delivery" && existing?.presentation !== "delivery") return [];
          // Once Companion has forwarded an explicit queue entry to App Server,
          // the same durable command becomes the optimistic chat row. Keeping
          // its command id makes the later canonical user item replace this row
          // atomically instead of leaving a gap between queue and history.
          const acceptedQueueHandoff = command.presentation === "queue" && command.state === "delivered";
          // A delivered receipt is useful only while handing an existing
          // durable queue row to the chat projection. Reconstructing every
          // historical delivered receipt after cache loss resurrects stale
          // optimistic bubbles on every queue/list refresh.
          if (acceptedQueueHandoff && existing === undefined) return [];
          const queuedInput = parseQueuedInput(command.params);
          const entry: PendingTimelineEntry = {
            commandId: command.commandId,
            method: "turn/start",
            presentation: acceptedQueueHandoff ? "delivery" : command.presentation,
            workspaceRequestId: command.workspaceRequestId,
            text: queuedInput.text,
            attachments: queuedInput.attachments,
            state: command.presentation === "delivery" || acceptedQueueHandoff
              ? pendingDeliveryStateFromCompanion(command.state)
              : command.state,
            attempts: existing?.attempts ?? 0,
            lastError: command.lastError,
            createdAt: command.createdAt,
            updatedAt: command.updatedAt,
            order: command.order,
          };
          return [[command.commandId, pendingRow(connectionId, threadId, entry)] as const];
      }));
      await writes.run(async () => {
        if (disposed) return;
        await runWriteTransaction((controls) => {
          let changed = false;
          for (const row of source.rowsForThread(connectionId, threadId)) {
            if (row.kind !== "pending" || row.pending === null || row.pending === undefined) continue;
            const retireMissingQueue = row.pending.presentation === "queue"
              && !incoming.has(row.pending.commandId)
              && !preserveCommandIds.has(row.pending.commandId);
            if (!retireMissingQueue) continue;
            if (deleteRow(source, controls, row.id)) changed = true;
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
          return { value: undefined, durable: changed };
        });
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
      const rows = source.rowsForThread(connectionId, threadId);
      const thread = materializeThreadDetail(rows, connectionId, threadId, sessionId)?.thread ?? null;
      if (thread?.turns.length === 0 && rows.some((row) => row.kind === "thread" && row.historyHadTurns === true)) return null;
      return thread;
    },
    close() {
      if (closePromise !== null) return closePromise;
      closing = true;
      windowIntents.close();
      for (const snapshot of projectionSnapshots.values()) snapshot.resolve();
      projectionSnapshots.clear();
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
          rangePulls.clear();
          reportedStalledOptimisticFingerprintByThread.clear();
          stagedPendingOverlays.clear();
          newerExhaustedTurnIdByThread.clear();
          olderExhaustedTurnIdByThread.clear();
          chat.close();
        }
      })();
      return closePromise;
    },
  };
  return database;
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

function threadRow(
  connectionId: string,
  thread: Thread,
  sessionId: string | null,
  lastOpenedAt: number,
  historyEpoch: number,
  historyCursor?: string | null,
  historyHadTurns?: boolean,
  historyCoverageMinOrdinal?: number | null,
  historyCoverageMaxOrdinal?: number | null,
  projectionCursor?: number,
  historySourceWitness?: string,
  currentUsage: ThreadCurrentUsage | null = null,
  currentOutcome: ThreadCurrentOutcome | null = null,
): ThreadDetailRow {
  return {
    ...baseRow(threadMetaKey(connectionId, thread.id), "thread", connectionId, thread.id, null, historyEpoch, -1, sessionId, lastOpenedAt),
    ...(historyCursor === undefined ? {} : { historyCursor }),
    ...(historyHadTurns === undefined ? {} : { historyHadTurns }),
    ...(historyCoverageMinOrdinal === undefined ? {} : { historyCoverageMinOrdinal }),
    ...(historyCoverageMaxOrdinal === undefined ? {} : { historyCoverageMaxOrdinal }),
    ...(projectionCursor === undefined ? {} : { projectionCursor }),
    ...(historySourceWitness === undefined ? {} : { historySourceWitness }),
    thread: stripThreadTurns(thread),
    currentUsage,
    currentOutcome,
  };
}

type HistoryCoverage = {
  min: number | null | undefined;
  max: number | null | undefined;
};

/** Durable lookup rows never enter the resident source solely because they establish position. */
function mergeHistoryFacts(facts: readonly ThreadDetailRow[], resident: readonly ThreadDetailRow[]): ThreadDetailRow[] {
  const merged = new Map(facts.map((row) => [row.id, row]));
  for (const row of resident) merged.set(row.id, row);
  return [...merged.values()];
}

/** Only the contiguous prefix proves that advancing the current edge cannot skip history. */
function contiguousHistoryPage(rows: readonly ThreadDetailRow[], boundary: number, direction: "older" | "newer"): ThreadDetailRow[] {
  const step = direction === "older" ? -1 : 1;
  const ordered = [...rows].sort((left, right) => step * (left.ordinal - right.ordinal));
  const result: ThreadDetailRow[] = [];
  let expected = boundary + step;
  for (const row of ordered) {
    if (row.ordinal !== expected) break;
    result.push(row);
    expected += step;
  }
  return result;
}

function projectAuthoritativeCoverage(
  previousMeta: ThreadDetailRow | undefined,
  existingRows: readonly ThreadDetailRow[],
  previousHistoryEpoch: number,
  historyEpoch: number,
  turns: readonly Turn[],
  ordinals: ReadonlyMap<string, number>,
  mode: "authoritative" | "reset" | "live" | "append" | "tail",
  historyHadTurns: boolean | undefined,
): HistoryCoverage {
  const previous = metadataCoverage(previousMeta);
  if (mode === "live") return previous;
  const incoming = turnOrdinalCoverage(turns, ordinals);
  if (mode === "reset" || mode === "tail") return incoming;
  if (incoming.min === null || incoming.max === null) {
    if (mode === "authoritative" && historyHadTurns === false) return { min: null, max: null };
    return previous;
  }
  const hasResidentHistory = existingRows.some((row) => row.kind === "turn" && row.historyEpoch === previousHistoryEpoch);
  if (historyEpoch !== previousHistoryEpoch || !hasResidentHistory) return incoming;
  return mergeAdjacentCoverage(previous, incoming);
}

function extendAuthoritativeCoverage(
  metadata: ThreadDetailRow | undefined,
  turns: readonly Turn[],
  ordinals: ReadonlyMap<string, number>,
): HistoryCoverage {
  return mergeAdjacentCoverage(metadataCoverage(metadata), turnOrdinalCoverage(turns, ordinals));
}

function metadataCoverage(metadata: ThreadDetailRow | undefined): HistoryCoverage {
  return {
    min: metadata?.kind === "thread" ? metadata.historyCoverageMinOrdinal : undefined,
    max: metadata?.kind === "thread" ? metadata.historyCoverageMaxOrdinal : undefined,
  };
}

function turnOrdinalCoverage(turns: readonly Turn[], ordinals: ReadonlyMap<string, number>): HistoryCoverage {
  const values = turns.flatMap(({ id }) => {
    const ordinal = ordinals.get(id);
    return ordinal === undefined ? [] : [ordinal];
  });
  return values.length === 0
    ? { min: null, max: null }
    : { min: Math.min(...values), max: Math.max(...values) };
}

function mergeAdjacentCoverage(previous: HistoryCoverage, incoming: HistoryCoverage): HistoryCoverage {
  if (incoming.min === undefined || incoming.max === undefined || incoming.min === null || incoming.max === null) return previous;
  if (previous.min === undefined || previous.max === undefined || previous.min === null || previous.max === null) return incoming;
  const adjacent = incoming.min <= previous.max + 1 && incoming.max >= previous.min - 1;
  return adjacent
    ? { min: Math.min(previous.min, incoming.min), max: Math.max(previous.max, incoming.max) }
    : incoming;
}

function mergeThreadPresentationMetadata(detail: Thread, snapshot: Thread): Thread {
  return {
    ...detail,
    name: snapshot.name,
    preview: snapshot.preview,
    cwd: snapshot.cwd,
    updatedAt: snapshot.updatedAt,
    recencyAt: snapshot.recencyAt,
    parentThreadId: snapshot.parentThreadId,
    agentNickname: snapshot.agentNickname,
    agentRole: snapshot.agentRole,
  };
}

function projectionOperationClosesStartedShell(kind: string): boolean {
  return kind === "turnCompleted" || kind === "threadDeleted";
}

export function threadWindowCoverage(
  request: Pick<ThreadChatWindowRequest, "anchorTurnId">,
  rows: {
    turnRows: readonly ThreadDetailRow[];
    liveRows: readonly ThreadDetailRow[];
  },
): ThreadWindowCoverage {
  const metadata = rows.liveRows.find((row) => row.kind === "thread");
  if (metadata === undefined) return { complete: false, reason: "metadata-missing" };
  // Cursor-backed sealed rows are immutable; a live-journal turn is not. It
  // may be an in-progress stream, or a locally observed completion whose
  // canonical final projection has not reached SQLite yet. Always show the
  // cached window immediately, but force its bounded authoritative head read
  // until an authoritative write seals this head.
  if (rows.liveRows.some((row) => row.kind === "turn" && !row.sealed)) {
    return { complete: false, reason: "mutable-head" };
  }
  if (metadata.historyCursor === undefined) return { complete: false, reason: "tail-uninitialized" };
  if (metadata.historyCoverageMinOrdinal === undefined || metadata.historyCoverageMaxOrdinal === undefined) {
    return { complete: false, reason: "coverage-unproven" };
  }
  const turns = [...rows.turnRows, ...rows.liveRows].filter((row) => row.kind === "turn" && row.turn !== null);
  if (request.anchorTurnId !== null
    && !turns.some((row) => row.remoteTurnId === request.anchorTurnId)) {
    return { complete: false, reason: "anchor-missing" };
  }
  const coverageMin = metadata.historyCoverageMinOrdinal;
  const coverageMax = metadata.historyCoverageMaxOrdinal;
  if (coverageMin === null || coverageMax === null) {
    return coverageMin === null
      && coverageMax === null
      && turns.length === 0
      && metadata.historyHadTurns === false
      && metadata.historyCursor === null
      ? { complete: true, reason: "complete" }
      : { complete: false, reason: "history-evicted" };
  }
  const anchorOrdinal = request.anchorTurnId === null
    ? null
    : turns.find((row) => row.remoteTurnId === request.anchorTurnId)?.ordinal ?? null;
  if (request.anchorTurnId !== null && anchorOrdinal === null) return { complete: false, reason: "anchor-missing" };
  const expectedMax = anchorOrdinal === null
    ? coverageMax
    : Math.min(coverageMax, anchorOrdinal + THREAD_HISTORY_PAGE_SIZE);
  const expectedMin = Math.max(coverageMin, expectedMax - THREAD_RESIDENT_TURN_LIMIT + 1);
  const residentOrdinals = new Set(rows.turnRows.flatMap((row) => row.kind === "turn" && row.sealed ? [row.ordinal] : []));
  for (let ordinal = expectedMin; ordinal <= expectedMax; ordinal += 1) {
    if (!residentOrdinals.has(ordinal)) return { complete: false, reason: "history-evicted" };
  }
  return { complete: true, reason: "complete" };
}

function turnRow(
  connectionId: string,
  threadId: string,
  turn: Turn,
  ordinal: number,
  historyEpoch: number,
  completionProof: "authoritative" | "live",
): ThreadDetailRow {
  return {
    ...baseRow(turnStorageKey(connectionId, threadId, turn), "turn", connectionId, threadId, turn.id, historyEpoch, ordinal, null, 0),
    // Live journal rows remain mutable through completion. The ordered stream
    // repair reads the canonical turn, replaces this row, and seals it once.
    sealed: completionProof === "authoritative" && turn.status !== "inProgress",
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
    turnMetadata: cloneProtocolValue(metadata),
  };
}

function activityRow(connectionId: string, threadId: string, turnId: string, ordinal: number, items: Turn["items"], historyEpoch: number): ThreadDetailRow {
  return {
    ...baseRow(activityKey(connectionId, threadId, turnId), "activity", connectionId, threadId, turnId, historyEpoch, ordinal, null, 0),
    sealed: true,
    activityItems: cloneProtocolValue(items),
  };
}

function pendingRow(connectionId: string, threadId: string, entry: PendingTimelineEntry, historyEpoch = 0): ThreadDetailRow {
  return {
    ...baseRow(pendingTimelineRowId(connectionId, threadId, entry.commandId), "pending", connectionId, threadId, null, historyEpoch, entry.order, null, 0),
    pending: entry,
  };
}

function composeInitialRangeRows(
  residentRows: readonly ThreadDetailRow[],
  loadedRows: readonly ThreadDetailRow[],
  historyEpoch: number,
): ThreadDetailRow[] {
  const rows = new Map<string, ThreadDetailRow>();
  for (const row of loadedRows) {
    if (row.kind === "pending" || row.kind === "thread" || row.historyEpoch === historyEpoch) rows.set(row.id, row);
  }
  // Pending delivery and mutable stream rows can change while the SQLite read
  // is in flight. They overlay the cold range; old sealed rows do not.
  for (const row of residentRows) {
    if (row.kind === "pending" || row.kind === "thread" || (!row.sealed && row.historyEpoch === historyEpoch)) rows.set(row.id, row);
  }
  return [...rows.values()];
}

/** Adds one twelve-turn page without evicting while the list is moving. SQLite
 * remains the durable owner; the expanded in-memory range is trimmed after the
 * gesture ends. */
function composeExpandedRangeRows(
  residentRows: readonly ThreadDetailRow[],
  loadedRows: readonly ThreadDetailRow[],
  historyEpoch: number,
): ThreadDetailRow[] {
  const combined = new Map<string, ThreadDetailRow>();
  for (const row of residentRows) combined.set(row.id, row);
  for (const row of loadedRows) combined.set(row.id, row);
  return [...combined.values()].filter((row) => row.kind === "pending" || row.kind === "thread" || row.historyEpoch === historyEpoch);
}

/** Drops only the page farthest from the completed gesture direction. */
function trimExpandedRangeRows(
  residentRows: readonly ThreadDetailRow[],
  historyEpoch: number,
  direction: "older" | "newer",
  residentTurnLimit: number,
): ThreadDetailRow[] {
  const combined = new Map<string, ThreadDetailRow>();
  for (const row of residentRows) combined.set(row.id, row);
  const turns = [...combined.values()]
    .filter((row) => row.kind === "turn" && row.sealed && row.historyEpoch === historyEpoch)
    .sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id));
  const selectedTurns = direction === "older"
    ? turns.slice(0, residentTurnLimit)
    : turns.slice(-residentTurnLimit);
  const selectedTurnIds = new Set(selectedTurns.map(({ id }) => id));
  const selectedOrdinals = new Set(selectedTurns.map(({ ordinal }) => ordinal));
  return [...combined.values()].filter((row) => {
    if (row.kind === "thread" || row.kind === "pending" || !row.sealed) {
      return row.kind === "pending" || row.kind === "thread" || row.historyEpoch === historyEpoch;
    }
    if (row.historyEpoch !== historyEpoch) return false;
    if (row.kind === "turn") return selectedTurnIds.has(row.id);
    return (row.kind === "turnMeta" || row.kind === "activity") && selectedOrdinals.has(row.ordinal);
  });
}

function rangeMembership(
  rows: readonly ThreadDetailRow[],
  historyEpoch: number,
): Pick<ThreadChatWindowSnapshot, "turnRowIds" | "detailRowIds" | "liveRowIds"> {
  const compareRows = (left: ThreadDetailRow, right: ThreadDetailRow): number => (
    right.ordinal - left.ordinal || right.id.localeCompare(left.id)
  );
  return {
    turnRowIds: rows
      .filter((row) => row.kind === "turn" && row.sealed && row.historyEpoch === historyEpoch)
      .sort(compareRows)
      .map(({ id }) => id),
    detailRowIds: rows
      .filter((row) => row.sealed
        && row.historyEpoch === historyEpoch
        && (row.kind === "turnMeta" || row.kind === "activity"))
      .sort(compareRows)
      .map(({ id }) => id),
    liveRowIds: rows
      .filter((row) => !row.sealed && (row.kind === "pending" || row.historyEpoch === historyEpoch))
      .sort(compareRows)
      .map(({ id }) => id),
  };
}

function sameStringSequence(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function minimumNullable(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.min(left, right);
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

function writeRow(source: Map<string, ThreadDetailRow>, controls: SyncWriteControls, key: string, row: ThreadDetailRow): boolean {
  const previous = source.get(key);
  if (previous !== undefined && sameThreadDetailRow(previous, row)) return false;
  controls.write({ type: previous === undefined ? "insert" : "update", value: row });
  source.set(key, row);
  return true;
}

function sameThreadDetailRow(previous: ThreadDetailRow, next: ThreadDetailRow): boolean {
  if (
    previous.kind !== next.kind
    || previous.id !== next.id
    || previous.historyEpoch !== next.historyEpoch
    || previous.historyCursor !== next.historyCursor
    || previous.historyHadTurns !== next.historyHadTurns
    || previous.historyCoverageMinOrdinal !== next.historyCoverageMinOrdinal
    || previous.historyCoverageMaxOrdinal !== next.historyCoverageMaxOrdinal
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
  return JSON.stringify(previous.thread) === JSON.stringify(next.thread)
    && JSON.stringify(previous.currentUsage) === JSON.stringify(next.currentUsage)
    && JSON.stringify(previous.currentOutcome) === JSON.stringify(next.currentOutcome);
}

function deleteRow(source: Map<string, ThreadDetailRow>, controls: SyncWriteControls, key: string): boolean {
  if (!source.has(key)) return false;
  controls.write({ type: "delete", key });
  source.delete(key);
  return true;
}

async function deleteThreadRows(source: ThreadDetailSource, controls: SyncControls, connectionId: string, threadId: string): Promise<void> {
  await runThreadDetailTransaction(source, controls, (writes) => {
    let mutationCount = 0;
    // Deleting one thread must not scan every hydrated row from every server.
    for (const row of source.rowsForThread(connectionId, threadId)) {
      if (deleteRow(source, writes, row.id)) mutationCount += 1;
    }
    return { value: undefined, durable: mutationCount > 0 };
  });
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

function pendingDeliveryReconciliationDiagnostics(
  rows: readonly ThreadDetailRow[],
  activeCommandIds: ReadonlySet<string>,
  now = Date.now(),
): {
  pendingDeliveryCount: number;
  inactiveDeliveryCount: number;
  oldestInactiveAgeMs: number;
  stalledCommandIds: string[];
} {
  let pendingDeliveryCount = 0;
  let inactiveDeliveryCount = 0;
  let oldestInactiveAgeMs = 0;
  const stalledCommandIds: string[] = [];
  for (const row of rows) {
    const pending = row.kind === "pending" && row.pending?.presentation === "delivery"
      ? row.pending
      : null;
    if (pending === null) continue;
    pendingDeliveryCount += 1;
    if (pending.confirmation !== undefined) continue;
    if (activeCommandIds.has(pending.commandId)) continue;
    inactiveDeliveryCount += 1;
    const ageMs = Math.max(0, now - Math.max(pending.createdAt, pending.updatedAt));
    oldestInactiveAgeMs = Math.max(oldestInactiveAgeMs, ageMs);
    if (ageMs >= OPTIMISTIC_RECONCILIATION_STALL_MS) stalledCommandIds.push(pending.commandId);
  }
  return { pendingDeliveryCount, inactiveDeliveryCount, oldestInactiveAgeMs, stalledCommandIds };
}

function samePendingTimelineEntry(left: PendingTimelineEntry, right: PendingTimelineEntry): boolean {
  return left.commandId === right.commandId
    && left.method === right.method
    && left.presentation === right.presentation
    && left.workspaceRequestId === right.workspaceRequestId
    && left.text === right.text
    && JSON.stringify(left.attachments) === JSON.stringify(right.attachments)
    && left.state === right.state
    && left.confirmation?.turnId === right.confirmation?.turnId
    && left.confirmation?.itemId === right.confirmation?.itemId
    && left.attempts === right.attempts
    && left.lastError === right.lastError
    && left.createdAt === right.createdAt
    && left.updatedAt === right.updatedAt
    && left.order === right.order;
}
