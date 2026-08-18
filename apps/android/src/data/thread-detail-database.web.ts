import type { Thread, Turn } from "@codewide/codex-protocol/v0.147.0/v2";
import type { SyncEvent, SyncSnapshotThread } from "@codewide/sync-client";
import type { NativeCommandDelivery } from "../native/native-transport";
import type { HostQueuedPrompt } from "./queue-event";
import type { PendingTimelineEntry, PendingTimelineMutation, ThreadDetailRow } from "./thread-detail-projection";

export { materializePendingTimeline, materializeThreadDetails, materializeThreadTurns } from "./thread-detail-projection";
export type { PendingTimelineEntry, ThreadDetailRow, ThreadDetailSnapshot } from "./thread-detail-projection";
export type ThreadDetailDatabase = {
  readonly sessionId: string;
  collection: never;
  prepare(): Promise<void>;
  applySnapshot(connectionId: string, threads: SyncSnapshotThread[], cursor: number): Promise<void>;
  applyEvents(connectionId: string, events: SyncEvent[]): Promise<void>;
  captureRefreshCursor(connectionId: string, threadId: string): number | null;
  replaceThread(connectionId: string, thread: Thread, cleanThroughCursor?: number | null): Promise<void>;
  prependTurns(connectionId: string, threadId: string, turns: Turn[]): Promise<void>;
  replaceTurnItems(connectionId: string, threadId: string, turnId: string, items: Turn["items"]): Promise<void>;
  createPending(input: Omit<PendingTimelineEntry, "order"> & { order?: number; connectionId: string; threadId: string }): ThreadDetailRow;
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

export function createThreadDetailDatabase(): ThreadDetailDatabase {
  throw new Error("Thread detail database is Android only");
}
