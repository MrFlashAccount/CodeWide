import type { Thread, Turn } from "@codewide/codex-protocol/v0.147.0/v2";
import type { SyncEvent, SyncSnapshotThread } from "@codewide/sync-client";
import type {
  PendingTimelineEntry,
  PendingTimelineMutation,
  ThreadDetailRow,
} from "./thread-detail-projection";
import type { HostQueuedPrompt } from "./queue-event";
import type { NativeCommandDelivery } from "../native/native-transport-contract";
import type { ThreadEventProjection } from "./thread-projection-store";
import type {
  ThreadChatModel,
  ThreadChatWindowRequest,
  ThreadChatWindowResource,
  ThreadChatWindowSnapshot,
} from "./thread-chat-model";

/** Owns one thread's durable detail model and windowed timeline mutations. */
export type ThreadDetailDatabase = {
  readonly sessionId: string;
  readonly chat: ThreadChatModel;
  prepare(): Promise<void>;
  setRemoteLoader(loader: ThreadRemoteLoader): void;
  windowResource(request: ThreadChatWindowRequest): ThreadChatWindowResource;
  preloadWindow(request: ThreadChatWindowRequest): () => void;
  retainWindow(connectionId: string, threadId: string): () => void;
  adoptPreloadedWindow(connectionId: string, threadId: string): void;
  loadWindow(request: ThreadChatWindowRequest): Promise<void>;
  pullRange(
    connectionId: string,
    threadId: string,
    direction: "older" | "newer" | "latest",
  ): Promise<boolean>;
  trimRange(connectionId: string, threadId: string, direction: "older" | "newer"): Promise<boolean>;
  readWindowRows(snapshot: ThreadChatWindowSnapshot): {
    turnRows: ThreadDetailRow[];
    detailRows: ThreadDetailRow[];
    liveRows: ThreadDetailRow[];
  };
  windowCoverage(
    request: ThreadChatWindowRequest,
    snapshot: ThreadChatWindowSnapshot,
  ): ThreadWindowCoverage;
  applySnapshot(connectionId: string, threads: SyncSnapshotThread[], cursor: number): Promise<void>;
  applyEvents(connectionId: string, events: SyncEvent[]): Promise<ThreadEventProjection>;
  liveRevision(connectionId: string, threadId: string): number;
  historyCursor(connectionId: string, threadId: string): string | null | undefined;
  historySourceWitness(connectionId: string, threadId: string): string | undefined;
  latestSealedTurnId(connectionId: string, threadId: string): Promise<string | null>;
  beginProjectionSnapshot(connectionId: string, threadId: string): () => void;
  synchronizeThread(input: ThreadSynchronization): Promise<void>;
  importThreadSnapshot(
    connectionId: string,
    thread: Thread,
    reason: ThreadSnapshotImportReason,
    historyCursor?: string | null,
  ): Promise<void>;
  replaceThreadSnapshot(
    connectionId: string,
    thread: Thread,
    reason: ThreadSnapshotImportReason,
    historyCursor: string | null,
  ): Promise<void>;
  mergeTailTurns(
    connectionId: string,
    threadId: string,
    turns: Turn[],
    historyCursor: string | null,
    isCurrent?: () => boolean,
  ): Promise<void>;
  appendTurns(
    connectionId: string,
    threadId: string,
    turns: Turn[],
    historyCursor?: string | null,
  ): Promise<ThreadHistoryAppendResult>;
  appendTurnsAfter(
    connectionId: string,
    threadId: string,
    expectedHistoryEpoch: number,
    afterTurnId: string,
    turns: Turn[],
    sourceWitness: string,
    isCurrent: () => boolean,
    requestedSourceWitness: string | undefined,
  ): Promise<ThreadHistoryAppendResult>;
  prependTurnsBefore(
    connectionId: string,
    threadId: string,
    expectedHistoryEpoch: number,
    beforeTurnId: string,
    turns: Turn[],
    hasMore: boolean,
    sourceWitness: string,
    isCurrent: () => boolean,
    requestedSourceWitness: string | undefined,
  ): Promise<ThreadHistoryAppendResult>;
  invalidateHistoryExhaustion(connectionId: string, threadId?: string): void;
  replaceActiveThread(connectionId: string, thread: Thread): Promise<void>;
  prependTurns(
    connectionId: string,
    threadId: string,
    expectedHistoryEpoch: number,
    turns: Turn[],
    nextCursor: string | null,
    isCurrent?: () => boolean,
  ): Promise<ThreadHistoryPrependResult>;
  replaceTurnItems(
    connectionId: string,
    threadId: string,
    turnId: string,
    items: Turn["items"],
  ): Promise<void>;
  createPending(input: PendingTimelineInput): ThreadDetailRow;
  stagePendingMutation(mutation: PendingTimelineMutation): { rollback(): void; complete(): void };
  commitPending(row: ThreadDetailRow, options?: { durable?: boolean }): Promise<boolean>;
  commitPendingMutation(
    mutation: PendingTimelineMutation,
    options?: { durable?: boolean },
  ): Promise<boolean>;
  applyCommandDelivery(delivery: NativeCommandDelivery): Promise<void>;
  reconcileNativeCommands(
    connectionId: string,
    threadId: string,
    deliveries: readonly NativeCommandDelivery[],
  ): Promise<void>;
  replaceQueued(
    connectionId: string,
    threadId: string,
    commands: HostQueuedPrompt[],
    preserveCommandIds?: Set<string>,
  ): Promise<void>;
  hasPendingDelivery(connectionId: string, threadId: string, commandId: string): boolean;
  listQueued(connectionId: string, threadId: string): PendingTimelineEntry[];
  planQueuedEdit(
    connectionId: string,
    commandId: string,
    text: string,
    attachments: PendingTimelineEntry["attachments"],
  ): PendingTimelineMutation | null;
  planQueuedRemoval(connectionId: string, commandId: string): PendingTimelineMutation | null;
  planQueuedMove(
    connectionId: string,
    threadId: string,
    commandId: string,
    direction: -1 | 1,
  ): PendingTimelineMutation | null;
  getThread(connectionId: string, threadId: string): Thread | null;
  close(): Promise<void>;
};

/** Explains whether a loaded timeline window proves complete thread coverage. */
export type ThreadWindowCoverage = {
  complete: boolean;
  reason:
    | "complete"
    | "metadata-missing"
    | "mutable-head"
    | "tail-uninitialized"
    | "coverage-unproven"
    | "anchor-missing"
    | "history-evicted";
};

/** Loads and observes authoritative thread ranges from the remote server. */
export type ThreadRemoteLoader = {
  observe?(input: { connectionId: string; threadId: string }): void;
  reconcilePending(input: { connectionId: string; threadId: string }): Promise<void>;
  hydrateWindow(input: {
    request: ThreadChatWindowRequest;
    cachedThread: Thread | null;
    requireAuthoritative: boolean;
    reason: ThreadWindowCoverage["reason"] | "activation";
  }): Promise<void>;
  shouldRepairProjection?(input: { connectionId: string; threadId: string }): boolean;
  repairProjection(input: { connectionId: string; threadId: string }): Promise<void>;
  loadOlder(input: {
    connectionId: string;
    threadId: string;
    cursor: string;
    historyEpoch: number;
  }): Promise<void>;
  loadNewer(input: {
    connectionId: string;
    threadId: string;
    afterTurnId: string;
    historyEpoch: number;
  }): Promise<ThreadRemoteNewerResult>;
  loadBefore?(input: {
    connectionId: string;
    threadId: string;
    beforeTurnId: string;
    historyEpoch: number;
  }): Promise<ThreadRemoteOlderResult>;
};

/** Result of attempting to persist a newer remote timeline page. */
export type ThreadRemoteNewerResult =
  | { status: "persisted"; lastTurnId: string; hasMore: boolean }
  | { status: "superseded" };

/** Result of attempting to persist an older remote timeline page. */
export type ThreadRemoteOlderResult =
  | { status: "persisted"; oldestTurnId: string; hasMore: boolean }
  | { status: "superseded" };

/** Describes whether prepending history extended the accepted local window. */
export type ThreadHistoryPrependResult = {
  accepted: boolean;
  historyEpoch: number;
  extendedMinimum: boolean;
};

/** Describes whether appending newer history was accepted for the active epoch. */
export type ThreadHistoryAppendResult = {
  accepted: boolean;
  historyEpoch: number;
};

/** Reason an authoritative thread snapshot enters local persistence. */
export type ThreadSnapshotImportReason = "initial" | "fork" | "recovery";

/** Controls whether snapshot persistence merges with or replaces local history. */
export type ThreadSnapshotSyncMode = "merge" | "reset";

/** Complete input required to synchronize one authoritative thread snapshot. */
export type ThreadSynchronization = {
  readonly connectionId: string;
  readonly thread: Thread;
  readonly mode: ThreadSnapshotSyncMode;
  readonly historyCursor: string | null | undefined;
  readonly throughCursor: number;
  readonly expectedLiveRevision: number;
  readonly sourceWitness?: string;
  readonly isCurrent?: () => boolean;
};

/** Content-free correlation input for a locally pending timeline entry. */
export type PendingTimelineInput = Omit<PendingTimelineEntry, "order" | "confirmation"> & {
  order?: number;
} & {
  connectionId: string;
  threadId: string;
};
