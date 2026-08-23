import type { SyncEvent, SyncSnapshotThread } from "@codewide/sync-client";

import type { StoredThreadSummary } from "./thread-summary-types";
import type { NativeCommandDelivery } from "../native/native-transport";
import type { ThreadSummaryModel, ThreadSummaryViewRequest, ThreadSummaryViewResource } from "./thread-summary-model";

export type ThreadSummaryDatabase = {
  readonly model: ThreadSummaryModel;
  prepare(): Promise<void>;
  viewResource(request: ThreadSummaryViewRequest): ThreadSummaryViewResource;
  loadView(request: ThreadSummaryViewRequest): Promise<void>;
  applySnapshot(connectionId: string, threads: SyncSnapshotThread[], cursor: number): Promise<void>;
  mergeSnapshots(connectionId: string, threads: SyncSnapshotThread[]): Promise<void>;
  applyEvents(connectionId: string, events: SyncEvent[]): Promise<void>;
  insertStartedThread(connectionId: string, thread: import("@codewide/codex-protocol/v0.147.0/v2").Thread): Promise<void>;
  beginDelete(connectionId: string, threadId: string, commandId: string): Promise<void>;
  rollbackDelete(connectionId: string, threadId: string, commandId: string): Promise<void>;
  applyCommandDelivery(delivery: NativeCommandDelivery): Promise<void>;
  reconcileDeleteCommands(deliveries: readonly NativeCommandDelivery[]): Promise<void>;
  setRenameHandler(handler: (connectionId: string, threadId: string, name: string) => Promise<void>): void;
  search(query: string, connectionId?: string | null): StoredThreadSummary[];
  updatePinned(connectionId: string, threadId: string, pinned: boolean): Promise<void>;
  updateArchived(connectionId: string, threadId: string, archived: boolean): Promise<void>;
  updateName(connectionId: string, threadId: string, name: string): Promise<void>;
  markRead(connectionId: string, threadId: string): Promise<void>;
  close(): void;
};

export function createThreadSummaryDatabase(): ThreadSummaryDatabase {
  throw new Error("The persisted thread database is available in the Android build only");
}

export function threadSummaryKey(connectionId: string, threadId: string): string {
  return `${connectionId}\u0000${threadId}`;
}
