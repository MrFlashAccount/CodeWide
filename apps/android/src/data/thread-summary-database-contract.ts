import type { SyncEvent, SyncSnapshotThread } from "@codewide/sync-client";
import type { NativeCommandDelivery } from "../native/native-transport-contract";
import type { StoredThreadSummary } from "./thread-summary-types";
import type { ThreadSummaryModel, ThreadSummaryViewRequest, ThreadSummaryViewResource } from "./thread-summary-model";
import type { ThreadCatalogRead } from "./thread-catalog-read";
import type { ProjectUnreadModel } from "./project-unread-model";

export type ThreadSummaryDatabase = {
  readonly model: ThreadSummaryModel;
  readonly projectUnread: ProjectUnreadModel;
  prepare(): Promise<void>;
  viewResource(request: ThreadSummaryViewRequest): ThreadSummaryViewResource;
  loadView(request: ThreadSummaryViewRequest): Promise<void>;
  get(connectionId: string, threadId: string): Promise<StoredThreadSummary | null>;
  applySnapshot(connectionId: string, threads: SyncSnapshotThread[], cursor: number): Promise<void>;
  replaceCatalog(connectionId: string, threads: SyncSnapshotThread[]): Promise<void>;
  beginCatalogRead(connectionId: string): ThreadCatalogRead;
  applyCatalogPage(connectionId: string, threads: SyncSnapshotThread[], archived: boolean, prefixIds: ReadonlySet<string>, read: ThreadCatalogRead, replaceHead: boolean, projectCwd?: string): Promise<void>;
  setCatalogLoader(loader: (request: ThreadSummaryViewRequest) => Promise<void>): void;
  replaceSubagentCatalog(connectionId: string, rootThreadId: string, threads: SyncSnapshotThread[]): Promise<void>;
  mergeSnapshots(connectionId: string, threads: SyncSnapshotThread[]): Promise<void>;
  applyEvents(connectionId: string, events: SyncEvent[]): Promise<void>;
  insertStartedThread(connectionId: string, thread: import("@codewide/codex-protocol/v0.147.0/v2").Thread): Promise<void>;
  beginDelete(connectionId: string, threadId: string, commandId: string): Promise<void>;
  rollbackDelete(connectionId: string, threadId: string, commandId: string): Promise<void>;
  applyCommandDelivery(delivery: NativeCommandDelivery): Promise<void>;
  reconcileDeleteCommands(deliveries: readonly NativeCommandDelivery[]): Promise<void>;
  setRenameHandler(handler: ThreadRenameHandler): void;
  search(query: string, connectionId?: string | null): Promise<StoredThreadSummary[]>;
  updatePinned(connectionId: string, threadId: string, pinned: boolean): Promise<void>;
  updateArchived(connectionId: string, threadId: string, archived: boolean): Promise<void>;
  updateName(connectionId: string, threadId: string, name: string): Promise<void>;
  markRead(connectionId: string, threadId: string): Promise<void>;
  close(): void;
};

export type ThreadRenameHandler = (connectionId: string, threadId: string, name: string) => Promise<void>;
