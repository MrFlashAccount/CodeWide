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
  // WHY: This signature mirrors an established storage or native compatibility contract; parameter order is part of every current implementation and caller.
  // oxlint-disable-next-line eslint/max-params
  appendTurns: (
    connectionId: string,
    threadId: string,
    turns: Turn[],
    historyCursor?: string | null,
  ) => Promise<ThreadHistoryAppendResult>;
  // WHY: This signature mirrors an established storage or native compatibility contract; parameter order is part of every current implementation and caller.
  // oxlint-disable-next-line eslint/max-params
  appendTurnsAfter: (
    connectionId: string,
    threadId: string,
    expectedHistoryEpoch: number,
    afterTurnId: string,
    turns: Turn[],
    sourceWitness: string,
    isCurrent: () => boolean,
    requestedSourceWitness: string | undefined,
  ) => Promise<ThreadHistoryAppendResult>;
  applyCommandDelivery: (delivery: NativeCommandDelivery) => Promise<void>;
  applyEvents: (connectionId: string, events: SyncEvent[]) => Promise<ThreadEventProjection>;
  applySnapshot: (
    connectionId: string,
    threads: SyncSnapshotThread[],
    cursor: number,
  ) => Promise<void>;
  beginProjectionSnapshot: (connectionId: string, threadId: string) => () => void;
  readonly chat: ThreadChatModel;
  close: () => Promise<void>;
  commitPending: (row: ThreadDetailRow, options?: { durable?: boolean }) => Promise<boolean>;
  commitPendingMutation: (
    mutation: PendingTimelineMutation,
    options?: { durable?: boolean },
  ) => Promise<boolean>;
  createPending: (input: PendingTimelineInput) => ThreadDetailRow;
  getThread: (connectionId: string, threadId: string) => Thread | null;
  hasPendingDelivery: (connectionId: string, threadId: string, commandId: string) => boolean;
  historyCursor: (connectionId: string, threadId: string) => string | null | undefined;
  historySourceWitness: (connectionId: string, threadId: string) => string | undefined;
  // WHY: This signature mirrors an established storage or native compatibility contract; parameter order is part of every current implementation and caller.
  // oxlint-disable-next-line eslint/max-params
  importThreadSnapshot: (
    connectionId: string,
    thread: Thread,
    reason: ThreadSnapshotImportReason,
    historyCursor?: string | null,
  ) => Promise<void>;
  invalidateHistoryExhaustion: (connectionId: string, threadId?: string) => void;
  latestSealedTurnId: (connectionId: string, threadId: string) => Promise<string | null>;
  listQueued: (connectionId: string, threadId: string) => PendingTimelineEntry[];
  liveRevision: (connectionId: string, threadId: string) => number;
  loadWindow: (request: ThreadChatWindowRequest) => Promise<void>;
  // WHY: This signature mirrors an established storage or native compatibility contract; parameter order is part of every current implementation and caller.
  // oxlint-disable-next-line eslint/max-params
  mergeTailTurns: (
    connectionId: string,
    threadId: string,
    turns: Turn[],
    historyCursor: string | null,
    isCurrent?: () => boolean,
  ) => Promise<void>;
  // WHY: This signature mirrors an established storage or native compatibility contract; parameter order is part of every current implementation and caller.
  // oxlint-disable-next-line eslint/max-params
  planQueuedEdit: (
    connectionId: string,
    commandId: string,
    text: string,
    attachments: PendingTimelineEntry["attachments"],
  ) => PendingTimelineMutation | null;
  // WHY: This signature mirrors an established storage or native compatibility contract; parameter order is part of every current implementation and caller.
  // oxlint-disable-next-line eslint/max-params
  planQueuedMove: (
    connectionId: string,
    threadId: string,
    commandId: string,
    direction: -1 | 1,
  ) => PendingTimelineMutation | null;
  planQueuedRemoval: (connectionId: string, commandId: string) => PendingTimelineMutation | null;
  prepare: () => Promise<void>;
  // WHY: This signature mirrors an established storage or native compatibility contract; parameter order is part of every current implementation and caller.
  // oxlint-disable-next-line eslint/max-params
  prependTurns: (
    connectionId: string,
    threadId: string,
    expectedHistoryEpoch: number,
    turns: Turn[],
    nextCursor: string | null,
    isCurrent?: () => boolean,
  ) => Promise<ThreadHistoryPrependResult>;
  // WHY: This signature mirrors an established storage or native compatibility contract; parameter order is part of every current implementation and caller.
  // oxlint-disable-next-line eslint/max-params
  prependTurnsBefore: (
    connectionId: string,
    threadId: string,
    expectedHistoryEpoch: number,
    beforeTurnId: string,
    turns: Turn[],
    hasMore: boolean,
    sourceWitness: string,
    isCurrent: () => boolean,
    requestedSourceWitness: string | undefined,
  ) => Promise<ThreadHistoryAppendResult>;
  pullRange: (
    connectionId: string,
    threadId: string,
    direction: "older" | "newer" | "latest",
  ) => Promise<boolean>;
  readWindowRows: (snapshot: ThreadChatWindowSnapshot) => {
    detailRows: ThreadDetailRow[];
    liveRows: ThreadDetailRow[];
    turnRows: ThreadDetailRow[];
  };
  reconcileNativeCommands: (
    connectionId: string,
    threadId: string,
    deliveries: readonly NativeCommandDelivery[],
  ) => Promise<void>;
  replaceActiveThread: (connectionId: string, thread: Thread) => Promise<void>;
  // WHY: This signature mirrors an established storage or native compatibility contract; parameter order is part of every current implementation and caller.
  // oxlint-disable-next-line eslint/max-params
  replaceQueued: (
    connectionId: string,
    threadId: string,
    commands: HostQueuedPrompt[],
    preserveCommandIds?: Set<string>,
  ) => Promise<void>;
  // WHY: This signature mirrors an established storage or native compatibility contract; parameter order is part of every current implementation and caller.
  // oxlint-disable-next-line eslint/max-params
  replaceThreadSnapshot: (
    connectionId: string,
    thread: Thread,
    reason: ThreadSnapshotImportReason,
    historyCursor: string | null,
  ) => Promise<void>;
  // WHY: This signature mirrors an established storage or native compatibility contract; parameter order is part of every current implementation and caller.
  // oxlint-disable-next-line eslint/max-params
  replaceTurnItems: (
    connectionId: string,
    threadId: string,
    turnId: string,
    items: Turn["items"],
  ) => Promise<void>;
  readonly sessionId: string;
  setRemoteLoader: (loader: ThreadRemoteLoader) => void;
  stagePendingMutation: (mutation: PendingTimelineMutation) => {
    complete: () => void;
    rollback: () => void;
  };
  synchronizeThread: (input: ThreadSynchronization) => Promise<void>;
  trimRange: (
    connectionId: string,
    threadId: string,
    direction: "older" | "newer",
  ) => Promise<boolean>;
  windowCoverage: (
    request: ThreadChatWindowRequest,
    snapshot: ThreadChatWindowSnapshot,
  ) => ThreadWindowCoverage;
  windowResource: (request: ThreadChatWindowRequest) => ThreadChatWindowResource;
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
  hydrateWindow: (input: {
    cachedThread: Thread | null;
    reason: ThreadWindowCoverage["reason"] | "activation";
    request: ThreadChatWindowRequest;
    requireAuthoritative: boolean;
  }) => Promise<void>;
  loadBefore?: (input: {
    beforeTurnId: string;
    connectionId: string;
    historyEpoch: number;
    threadId: string;
  }) => Promise<ThreadRemoteOlderResult>;
  loadNewer: (input: {
    afterTurnId: string;
    connectionId: string;
    historyEpoch: number;
    threadId: string;
  }) => Promise<ThreadRemoteNewerResult>;
  loadOlder: (input: {
    connectionId: string;
    cursor: string;
    historyEpoch: number;
    threadId: string;
  }) => Promise<void>;
  observe?: (input: { connectionId: string; threadId: string }) => () => void;
  reconcilePending: (input: { connectionId: string; threadId: string }) => Promise<void>;
  repairProjection: (input: { connectionId: string; threadId: string }) => Promise<void>;
  shouldRepairProjection?: (input: { connectionId: string; threadId: string }) => boolean;
};

/** Result of attempting to persist a newer remote timeline page. */
export type ThreadRemoteNewerResult =
  | { hasMore: boolean; lastTurnId: string; status: "persisted" }
  | { status: "superseded" };

/** Result of attempting to persist an older remote timeline page. */
export type ThreadRemoteOlderResult =
  | { hasMore: boolean; oldestTurnId: string; status: "persisted" }
  | { status: "superseded" };

/** Describes whether prepending history extended the accepted local window. */
export type ThreadHistoryPrependResult = {
  accepted: boolean;
  extendedMinimum: boolean;
  historyEpoch: number;
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
  readonly expectedLiveRevision: number;
  readonly historyCursor: string | null | undefined;
  readonly isCurrent?: () => boolean;
  readonly mode: ThreadSnapshotSyncMode;
  readonly sourceWitness?: string;
  readonly thread: Thread;
  readonly throughCursor: number;
};

/** Content-free correlation input for a locally pending timeline entry. */
export type PendingTimelineInput = Omit<PendingTimelineEntry, "order" | "confirmation"> & {
  order?: number;
} & {
  connectionId: string;
  threadId: string;
};
