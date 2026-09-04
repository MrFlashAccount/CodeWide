import type { Thread, Turn } from "@codewide/codex-protocol/v0.147.0/v2";
import type { SyncEvent, SyncSnapshotThread } from "@codewide/sync-client";
import type { NativeCommandDelivery } from "../native/native-transport";
import type { HostQueuedPrompt } from "./queue-event";
import type { PendingTimelineEntry, PendingTimelineMutation, ThreadDetailRow } from "./thread-detail-projection";
import type { ThreadEventProjection } from "./thread-projection-store";
import type { ThreadChatModel, ThreadChatWindowRequest, ThreadChatWindowResource, ThreadChatWindowSnapshot } from "./thread-chat-model";

export { materializePendingTimeline, materializeThreadDetails, materializeThreadTurns } from "./thread-detail-projection";
export type { PendingTimelineEntry, ThreadDetailRow, ThreadDetailSnapshot } from "./thread-detail-projection";
export type ThreadWindowCoverage = {
  complete: boolean;
  reason: "complete" | "metadata-missing" | "mutable-head" | "tail-uninitialized" | "coverage-unproven" | "anchor-missing" | "history-evicted";
};
export type ThreadRemoteLoader = {
  observe?(input: { connectionId: string; threadId: string }): void;
  reconcilePending(input: { connectionId: string; threadId: string }): Promise<void>;
  hydrateWindow(input: {
    request: ThreadChatWindowRequest;
    cachedThread: Thread | null;
    requireAuthoritative: boolean;
    reason: ThreadWindowCoverage["reason"] | "activation";
  }): Promise<void>;
  loadOlder(input: { connectionId: string; threadId: string; cursor: string; historyEpoch: number }): Promise<void>;
};
export type ThreadHistoryPrependResult = { accepted: boolean; historyEpoch: number; extendedMinimum: boolean };
export type ThreadHistoryAppendResult = { accepted: boolean; historyEpoch: number };
export type ThreadSnapshotImportReason = "initial" | "fork" | "recovery";
export type ThreadSnapshotSyncMode = "merge" | "reset";
export type ThreadSynchronization = {
  readonly connectionId: string;
  readonly thread: Thread;
  readonly mode: ThreadSnapshotSyncMode;
  readonly historyCursor: string | null;
  readonly expectedLiveRevision: number;
};
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
  pullRange(connectionId: string, threadId: string, direction: "older" | "newer" | "latest"): Promise<boolean>;
  readWindowRows(snapshot: ThreadChatWindowSnapshot): {
    turnRows: ThreadDetailRow[];
    detailRows: ThreadDetailRow[];
    liveRows: ThreadDetailRow[];
  };
  windowCoverage(request: ThreadChatWindowRequest, snapshot: ThreadChatWindowSnapshot): ThreadWindowCoverage;
  applySnapshot(connectionId: string, threads: SyncSnapshotThread[], cursor: number): Promise<void>;
  applyEvents(connectionId: string, events: SyncEvent[]): Promise<ThreadEventProjection>;
  liveRevision(connectionId: string, threadId: string): number;
  historyCursor(connectionId: string, threadId: string): string | null | undefined;
  latestSealedTurnId(connectionId: string, threadId: string): Promise<string | null>;
  synchronizeThread(input: ThreadSynchronization): Promise<void>;
  importThreadSnapshot(connectionId: string, thread: Thread, reason: ThreadSnapshotImportReason, historyCursor?: string | null): Promise<void>;
  replaceThreadSnapshot(connectionId: string, thread: Thread, reason: ThreadSnapshotImportReason, historyCursor: string | null): Promise<void>;
  appendTurns(connectionId: string, threadId: string, turns: Turn[], historyCursor?: string | null): Promise<ThreadHistoryAppendResult>;
  replaceActiveThread(connectionId: string, thread: Thread): Promise<void>;
  prependTurns(connectionId: string, threadId: string, expectedHistoryEpoch: number, turns: Turn[], nextCursor: string | null): Promise<ThreadHistoryPrependResult>;
  replaceTurnItems(connectionId: string, threadId: string, turnId: string, items: Turn["items"]): Promise<void>;
  createPending(input: Omit<PendingTimelineEntry, "order"> & { order?: number; connectionId: string; threadId: string }): ThreadDetailRow;
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

export function createThreadDetailDatabase(): ThreadDetailDatabase {
  throw new Error("Thread detail database is Android only");
}
