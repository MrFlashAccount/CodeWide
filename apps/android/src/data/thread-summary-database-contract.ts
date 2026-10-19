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
import type { ListStreamGeneration, ThreadListRow, ThreadListRowsFrame } from "./threadListRow";
import type { ThreadListRace } from "./threadListStream";

/** Server rows the database admitted under the race rule, published after their commit. */
export type ServerRowsChange =
  | {
      readonly kind: "merge";
      readonly removedThreadIds: readonly string[];
      readonly rows: readonly ThreadListRow[];
    }
  | {
      /** A snapshot replaced the connection's rows; `retainedThreadIds` kept newer pushes. */
      readonly kind: "replace";
      readonly retainedThreadIds: ReadonlySet<string>;
      readonly rows: readonly ThreadListRow[];
    };

/** One validated `thread/list` page read under one list-stream generation. */
export type ThreadCatalogPageRows = {
  readonly generation: ListStreamGeneration | null;
  readonly rows: readonly ThreadListRow[];
};

/** Ports the summary database consults and notifies for server-owned rows. */
export type ThreadSummaryDatabaseOptions = {
  readonly listRace: ThreadListRace;
  readonly onServerRows: (connectionId: string, change: ServerRowsChange) => void;
};

/** Owns persisted thread summaries and derived unread projections. */
export type ThreadSummaryDatabase = {
  /** Clears only a legacy pin batch durably acknowledged by its owning Companion. */
  acknowledgePinMigration: (connectionId: string, threadIds: readonly string[]) => Promise<void>;
  // WHY: This signature mirrors an established storage or native compatibility contract; parameter order is part of every current implementation and caller.
  // oxlint-disable-next-line eslint/max-params
  applyCatalogPage: (
    connectionId: string,
    page: ThreadCatalogPageRows,
    archived: boolean,
    prefixIds: ReadonlySet<string>,
    read: ThreadCatalogRead,
    replaceHead: boolean,
    projectCwd?: string,
  ) => Promise<void>;
  applyCommandDelivery: (delivery: NativeCommandDelivery) => Promise<void>;
  /** Applies device-owned fields of ordered journal events; server fields come from rows. */
  applyEvents: (connectionId: string, events: SyncEvent[]) => Promise<void>;
  /** Replaces server-owned pins without overwriting newer live pin events. */
  applyPinSnapshot: (
    connectionId: string,
    snapshot: { readonly cursor: number; readonly threadIds: readonly string[] },
  ) => Promise<void>;
  /** Writes one pushed `threadListRows` frame in one non-durable transaction. */
  applyServerRows: (
    connectionId: string,
    generation: ListStreamGeneration,
    frame: ThreadListRowsFrame,
  ) => Promise<void>;
  applySnapshot: (
    connectionId: string,
    threads: SyncSnapshotThread[],
    cursor: number,
  ) => Promise<void>;
  beginCatalogRead: (connectionId: string) => ThreadCatalogRead;
  beginDelete: (connectionId: string, threadId: string, commandId: string) => Promise<void>;
  close: () => void;
  deleteConnection: (connectionId: string) => Promise<void>;
  /** Satisfies catalog demand and reports whether remote cursors or the persisted range can continue. */
  ensureCatalog: (request: ThreadSummaryViewRequest) => Promise<boolean>;
  get: (connectionId: string, threadId: string) => Promise<StoredThreadSummary | null>;
  insertStartedThread: (
    connectionId: string,
    thread: import("@codewide/codex-protocol/v0.155.1/v2").Thread,
  ) => Promise<void>;
  /** Returns legacy pins still awaiting durable server import. */
  loadPendingPinMigration: (connectionId: string) => Promise<readonly string[]>;
  loadView: (request: ThreadSummaryViewRequest) => Promise<void>;
  /** Marks every persisted unread chat in the qualified project, independent of view limits. */
  markProjectRead: (connectionId: string, projectCwd: string) => Promise<void>;
  markRead: (connectionId: string, threadId: string) => Promise<void>;
  markUnread: (connectionId: string, threadId: string) => Promise<void>;
  /**
   * Inserts a `thread/read` or `companion/thread/sync` thread whose row is
   * missing; for an existing row it updates only device-owned turn attention.
   */
  mergeSnapshots: (
    connectionId: string,
    threads: SyncSnapshotThread[],
    throughCursor?: number,
  ) => Promise<void>;
  readonly model: ThreadSummaryModel;
  prepare: () => Promise<void>;
  readonly projectUnread: ProjectUnreadModel;
  reconcileCommands: (deliveries: readonly NativeCommandDelivery[]) => Promise<void>;
  /** Applies server-issued catalog removals independently of local pin/unread state. */
  removeCatalogEntries: (connectionId: string, threadIds: readonly string[]) => Promise<void>;
  replaceCatalog: (connectionId: string, threads: SyncSnapshotThread[]) => Promise<void>;
  replaceSubagentCatalog: (
    connectionId: string,
    rootThreadId: string,
    threads: SyncSnapshotThread[],
  ) => Promise<void>;
  rollbackDelete: (connectionId: string, threadId: string, commandId: string) => Promise<void>;
  search: (query: string, connectionId?: string | null) => Promise<StoredThreadSummary[]>;
  setCatalogLoader: (loader: (request: ThreadSummaryViewRequest) => Promise<boolean>) => void;
  setRenameHandler: (handler: ThreadRenameHandler) => void;
  /** Hides a local async question without submitting a user message. */
  skipQuestion: (request: {
    readonly connectionId: string;
    readonly itemId: string;
    readonly threadId: string;
    readonly turnId: string;
  }) => Promise<void>;
  updateArchived: (connectionId: string, threadId: string, archived: boolean) => Promise<void>;
  updateName: (connectionId: string, threadId: string, name: string) => Promise<void>;
  viewResource: (request: ThreadSummaryViewRequest) => ThreadSummaryViewResource;
};

/** Persists one explicit thread rename against its owning connection. */
export type ThreadRenameHandler = (
  connectionId: string,
  threadId: string,
  name: string,
) => Promise<void>;
