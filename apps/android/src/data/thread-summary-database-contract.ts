import type { SyncEvent, SyncSnapshotThread } from "@codewide/sync-client";
import type { NativeCommandDelivery } from "../native/native-transport-contract";
import type { StoredThreadSummary } from "./thread-summary-types";
import type {
  ThreadSummaryModel,
  ThreadSummaryViewRequest,
  ThreadSummaryViewResource,
} from "./thread-summary-model";
import type { ThreadCatalogRead } from "./thread-catalog-read";
import type { ProjectUnreadModel } from "./project-unread-model";

/** Owns persisted thread summaries and derived unread projections. */
export type ThreadSummaryDatabase = {
  // WHY: This signature mirrors an established storage or native compatibility contract; parameter order is part of every current implementation and caller.
  // oxlint-disable-next-line eslint/max-params
  applyCatalogPage: (
    connectionId: string,
    threads: SyncSnapshotThread[],
    archived: boolean,
    prefixIds: ReadonlySet<string>,
    read: ThreadCatalogRead,
    replaceHead: boolean,
    projectCwd?: string,
  ) => Promise<void>;
  applyCommandDelivery: (delivery: NativeCommandDelivery) => Promise<void>;
  applyEvents: (connectionId: string, events: SyncEvent[]) => Promise<void>;
  applySnapshot: (
    connectionId: string,
    threads: SyncSnapshotThread[],
    cursor: number,
  ) => Promise<void>;
  beginCatalogRead: (connectionId: string) => ThreadCatalogRead;
  beginDelete: (connectionId: string, threadId: string, commandId: string) => Promise<void>;
  close: () => void;
  get: (connectionId: string, threadId: string) => Promise<StoredThreadSummary | null>;
  insertStartedThread: (
    connectionId: string,
    thread: import("@codewide/codex-protocol/v0.147.0/v2").Thread,
  ) => Promise<void>;
  loadView: (request: ThreadSummaryViewRequest) => Promise<void>;
  markRead: (connectionId: string, threadId: string) => Promise<void>;
  mergeSnapshots: (connectionId: string, threads: SyncSnapshotThread[]) => Promise<void>;
  readonly model: ThreadSummaryModel;
  prepare: () => Promise<void>;
  readonly projectUnread: ProjectUnreadModel;
  reconcileDeleteCommands: (deliveries: readonly NativeCommandDelivery[]) => Promise<void>;
  replaceCatalog: (connectionId: string, threads: SyncSnapshotThread[]) => Promise<void>;
  replaceSubagentCatalog: (
    connectionId: string,
    rootThreadId: string,
    threads: SyncSnapshotThread[],
  ) => Promise<void>;
  rollbackDelete: (connectionId: string, threadId: string, commandId: string) => Promise<void>;
  search: (query: string, connectionId?: string | null) => Promise<StoredThreadSummary[]>;
  setCatalogLoader: (loader: (request: ThreadSummaryViewRequest) => Promise<void>) => void;
  setRenameHandler: (handler: ThreadRenameHandler) => void;
  updateArchived: (connectionId: string, threadId: string, archived: boolean) => Promise<void>;
  updateName: (connectionId: string, threadId: string, name: string) => Promise<void>;
  updatePinned: (connectionId: string, threadId: string, pinned: boolean) => Promise<void>;
  viewResource: (request: ThreadSummaryViewRequest) => ThreadSummaryViewResource;
};

/** Persists one explicit thread rename against its owning connection. */
export type ThreadRenameHandler = (
  connectionId: string,
  threadId: string,
  name: string,
) => Promise<void>;
