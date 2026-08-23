import type { Thread, Turn } from "@codewide/codex-protocol/v0.147.0/v2";
import type { SyncEvent, SyncSnapshotThread } from "@codewide/sync-client";
import type { NativeCommandDelivery } from "../native/native-transport";
import type { HostQueuedPrompt } from "./queue-event";
import type { PendingTimelineEntry, PendingTimelineMutation, ThreadDetailRow } from "./thread-detail-projection";
import type { ThreadEventProjection } from "./thread-projection-store";
import type { ThreadChatModel, ThreadChatWindowRequest, ThreadChatWindowResource, ThreadChatWindowSnapshot } from "./thread-chat-model";

export { materializePendingTimeline, materializeThreadDetails, materializeThreadTurns } from "./thread-detail-projection";
export type { PendingTimelineEntry, ThreadDetailRow, ThreadDetailSnapshot } from "./thread-detail-projection";
export type ThreadHistoryPrependResult = { accepted: boolean; historyEpoch: number; extendedMinimum: boolean };
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
  captureRefreshCursor(connectionId: string, threadId: string): number | null;
  replaceThread(connectionId: string, thread: Thread, cleanThroughCursor?: number | null): Promise<void>;
  prependTurns(connectionId: string, threadId: string, expectedHistoryEpoch: number, turns: Turn[]): Promise<ThreadHistoryPrependResult>;
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
