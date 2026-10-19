import type { SyncSnapshotThread } from "@codewide/sync-client";
import { appLogger } from "../observability/logger";
import type { SerialTaskQueue } from "./serial-task-queue";
import type {
  ThreadCatalogPageRows,
  ThreadSummaryDatabase,
  ThreadSummaryDatabaseOptions,
} from "./thread-summary-database-contract";
import { THREAD_CATALOG_PAGE_SIZE } from "./thread-catalog-loader";
import type { ThreadCatalogRead } from "./thread-catalog-read";
import type { ThreadSummaryViewRequest } from "./thread-summary-model";
import {
  retainThreadSummaryMissingFromSnapshot,
  threadSummaryKey,
} from "./thread-summary-projection";
import type { ThreadSummaryChange, ThreadSummarySqlite } from "./thread-summary-sqlite.native";
import type { StoredThreadSummary } from "./thread-summary-types";
import { isCatalogExcluded } from "./threadCatalogMembership";
import {
  parseThreadListRows,
  serverRowSummary,
  type ListStreamGeneration,
  type ThreadListRow,
  type ThreadListRowsFrame,
} from "./threadListRow";

/**
 * Writes of server-owned summary rows: pushed frames, catalog pages and native
 * snapshots. `serverRowSummary` merges each admitted row: server fields come
 * from the row and device-owned fields from the stored summary. Every write
 * runs in the database queue and consults the list-stream race owner there, so
 * decision order equals write order.
 */

/** A catalog head refresh evicts absent rows, but never one whose live turn or request is open. */
function catalogHeadEvictable(row: StoredThreadSummary): boolean {
  return row.status.type !== "active" && row.pendingRequestCount === 0;
}

/** Holds device-field events of threads without a row until their server row arrives. */
type PendingDeviceEvents = {
  /** Drops a removed thread's held events. */
  readonly discard: (connectionId: string, threadId: string) => void;
  /** Applies and drops the held events of a thread whose first row arrived. */
  readonly replayInto: (connectionId: string, row: StoredThreadSummary) => StoredThreadSummary;
};

type ServerRowWriterPorts = ThreadSummaryDatabaseOptions & {
  /** Adds the roots whose sub-agent activity the staged child rows change. */
  readonly applySubagentActivity: (
    connectionId: string,
    current: ReadonlyMap<string, StoredThreadSummary>,
    changed: Map<string, StoredThreadSummary | null>,
  ) => Promise<void>;
  readonly disposed: () => boolean;
  readonly overlay: PendingDeviceEvents;
  readonly publish: (changes: readonly ThreadSummaryChange[], refillBoundedViews: boolean) => void;
  readonly sameRow: (left: StoredThreadSummary, right: StoredThreadSummary) => boolean;
  readonly storage: ThreadSummarySqlite;
  /** Whether a change moves a row between bounded views (project, archive, pin, parent). */
  readonly viewMembershipChanged: (
    left: StoredThreadSummary,
    right: StoredThreadSummary,
  ) => boolean;
  readonly writes: SerialTaskQueue;
};

type RowBatch = {
  readonly admitted: ThreadListRow[];
  readonly changed: Map<string, StoredThreadSummary | null>;
  readonly current: Map<string, StoredThreadSummary>;
};

function emptyBatch(rows: readonly StoredThreadSummary[]): RowBatch {
  return {
    admitted: [],
    changed: new Map(),
    current: new Map(
      rows.map((row) => [threadSummaryKey(row.connectionId, row.remoteThreadId), row]),
    ),
  };
}

function batchChanges(
  batch: RowBatch,
  sameRow: ServerRowWriterPorts["sameRow"],
): ThreadSummaryChange[] {
  const changes: ThreadSummaryChange[] = [];
  for (const [key, row] of batch.changed) {
    const previous = batch.current.get(key);
    if (row === null) {
      if (previous !== undefined) {
        changes.push({ key, type: "delete" });
      }
    } else if (previous === undefined || !sameRow(previous, row)) {
      changes.push({ type: previous === undefined ? "insert" : "update", value: row });
    }
  }
  return changes;
}

function membershipChanged(
  batch: RowBatch,
  changes: readonly ThreadSummaryChange[],
  viewMembershipChanged: ServerRowWriterPorts["viewMembershipChanged"],
): boolean {
  // An insert or delete always changes membership; an update compares with its stored row.
  return changes.some(
    (change) =>
      change.type !== "update" ||
      viewMembershipChanged(
        batch.current.get(
          threadSummaryKey(change.value.connectionId, change.value.remoteThreadId),
        ) ?? change.value,
        change.value,
      ),
  );
}

function removedThreadIds(connectionId: string, batch: RowBatch): string[] {
  const prefixLength = threadSummaryKey(connectionId, "").length;
  return [...batch.changed].flatMap(([key, row]) =>
    row === null ? [key.slice(prefixLength)] : [],
  );
}

/** The window partition whose first page replaces its cached head. */
type HeadRequest = {
  readonly archived: boolean;
  readonly connectionId: string;
  readonly prefixIds: ReadonlySet<string>;
  readonly projectCwd: string | undefined;
  readonly read: ThreadCatalogRead;
};

/** The cached head a window's first page replaces. */
function headViewRequest(request: HeadRequest): ThreadSummaryViewRequest {
  const count = Math.max(THREAD_CATALOG_PAGE_SIZE, request.prefixIds.size);
  return {
    connectionId: request.connectionId,
    ...(request.projectCwd === undefined ? {} : { projectCwd: request.projectCwd }),
    archivedLimit: request.archived ? count : 0,
    recentLimit: request.archived ? 0 : count,
    selectedConnectionId: null,
    selectedThreadId: null,
    subagentConnectionId: null,
    subagentLimit: 0,
  };
}

/**
 * Paging a catalog must not erase device-owned unread state, and a row a push
 * changed during this read is newer than the page's absence.
 */
function evictableFromHead(
  row: StoredThreadSummary,
  prefixIds: ReadonlySet<string>,
  read: ThreadCatalogRead,
): boolean {
  return (
    !prefixIds.has(row.remoteThreadId) &&
    !row.pinned &&
    row.unread === 0 &&
    row.deleteCommandId === null &&
    catalogHeadEvictable(row) &&
    !read.changed.has(row.remoteThreadId)
  );
}

/** Server-row writes the summary database exposes unchanged. */
export type ServerRowWriter = Pick<
  ThreadSummaryDatabase,
  "applyCatalogPage" | "applyServerRows" | "applySnapshot"
>;

/** Creates the server-row writes of one summary database. */
export function createServerRowWriter(ports: ServerRowWriterPorts): ServerRowWriter {
  const { listRace, overlay, storage, writes } = ports;

  /** Admits one row under the race rule and stages its merged summary. */
  const stageRow = (connectionId: string, batch: RowBatch, row: ThreadListRow): void => {
    const key = threadSummaryKey(connectionId, row.threadId);
    if (!listRace.admitRow(connectionId, row.threadId, row.meta.cursor)) {
      return;
    }
    if (isCatalogExcluded(row.thread)) {
      overlay.discard(connectionId, row.threadId);
      batch.changed.set(key, null);
      return;
    }
    batch.admitted.push(row);
    const previous = batch.current.get(key);
    const merged = serverRowSummary(connectionId, row, previous);
    batch.changed.set(
      key,
      previous === undefined ? overlay.replayInto(connectionId, merged) : merged,
    );
  };

  /** Writes staged changes in one transaction and publishes them. */
  const commit = async (
    connectionId: string,
    batch: RowBatch,
    options: { readonly durable: boolean; readonly extraChanges?: readonly ThreadSummaryChange[] },
  ): Promise<{ readonly checkpoint: Promise<void> } | null> => {
    const { durable, extraChanges = [] } = options;
    await ports.applySubagentActivity(connectionId, batch.current, batch.changed);
    const changes = [...extraChanges, ...batchChanges(batch, ports.sameRow)];
    if (changes.length === 0) {
      return null;
    }
    storage.begin();
    for (const change of changes) {
      storage.write(change);
    }
    const checkpoint = storage.commit({ durable });
    ports.publish(
      changes,
      extraChanges.length > 0 || membershipChanged(batch, changes, ports.viewMembershipChanged),
    );
    return { checkpoint };
  };

  /**
   * One pushed frame is one non-durable transaction: the frame is not
   * journaled, so a lost checkpoint is recovered by the next page re-read.
   */
  const applyServerRows = async (
    connectionId: string,
    generation: ListStreamGeneration,
    frame: ThreadListRowsFrame,
  ): Promise<void> => {
    await writes.run(async () => {
      if (ports.disposed() || !listRace.isCurrent(connectionId, generation)) {
        return;
      }
      const threadIds = [
        ...frame.rows.map((row) => row.threadId),
        ...frame.removed.map((tombstone) => tombstone.threadId),
      ];
      const batch = emptyBatch(await storage.loadRows(connectionId, threadIds));
      for (const tombstone of frame.removed) {
        if (listRace.admitTombstone(connectionId, tombstone.threadId, tombstone.cursor)) {
          overlay.discard(connectionId, tombstone.threadId);
          batch.changed.set(threadSummaryKey(connectionId, tombstone.threadId), null);
        }
      }
      for (const row of frame.rows) {
        stageRow(connectionId, batch, row);
      }
      const written = await commit(connectionId, batch, { durable: false });
      written?.checkpoint.catch((error: unknown) => {
        appLogger.warnCaught({ error, event: "thread_list_stream.checkpoint.failed" });
      });
      ports.onServerRows(connectionId, {
        kind: "merge",
        removedThreadIds: removedThreadIds(connectionId, batch),
        rows: batch.admitted,
      });
    });
  };

  /** Evicts a stale cached head that the first page of a window replaced. */
  const staleHeadEvictions = async (request: HeadRequest): Promise<ThreadSummaryChange[]> => {
    const { archived, connectionId, prefixIds, read } = request;
    const window = await storage.loadView(headViewRequest(request));
    const evictions: ThreadSummaryChange[] = [];
    for (const row of archived ? window.archived : window.recent) {
      // Absence from this prefix is not a server deletion; older cached ranges stay.
      if (evictableFromHead(row, prefixIds, read)) {
        evictions.push({ key: threadSummaryKey(connectionId, row.remoteThreadId), type: "delete" });
      }
    }
    return evictions;
  };

  const stagePage = async (
    connectionId: string,
    page: ThreadCatalogPageRows,
  ): Promise<RowBatch> => {
    const threadIds = page.rows.map((row) => row.threadId);
    const batch = emptyBatch(await storage.loadRows(connectionId, threadIds));
    for (const row of page.rows) {
      stageRow(connectionId, batch, row);
    }
    return batch;
  };

  /** Removes rows a snapshot omits unless they live outside it or a newer push kept them. */
  const stageSnapshotRemovals = (
    connectionId: string,
    batch: RowBatch,
    snapshot: {
      readonly cursor: number;
      readonly listed: ReadonlySet<string>;
      readonly retained: Set<string>;
    },
  ): void => {
    const { retained } = snapshot;
    for (const [key, row] of batch.current) {
      if (snapshot.listed.has(row.remoteThreadId) || retainThreadSummaryMissingFromSnapshot(row)) {
        continue;
      }
      if (listRace.newerThan(connectionId, row.remoteThreadId, snapshot.cursor)) {
        retained.add(row.remoteThreadId);
      } else {
        batch.changed.set(key, null);
      }
    }
  };

  // WHY: This mirrors the existing ThreadSummaryDatabase.applyCatalogPage contract parameters.
  // oxlint-disable-next-line eslint/max-params
  const applyCatalogPage = async (
    connectionId: string,
    page: ThreadCatalogPageRows,
    archived: boolean,
    prefixIds: ReadonlySet<string>,
    read: ThreadCatalogRead,
    replaceHead: boolean,
    projectCwd?: string,
  ): Promise<void> => {
    await writes.run(async () => {
      // A page of a replaced socket is stale as a whole, including its head.
      if (ports.disposed() || !listRace.isCurrent(connectionId, page.generation)) {
        return;
      }
      const evictions = replaceHead
        ? staleHeadEvictions({ archived, connectionId, prefixIds, projectCwd, read })
        : Promise.resolve([]);
      const batch = await stagePage(connectionId, page);
      const extraChanges = (await evictions).filter(
        (change) => change.type === "delete" && !batch.changed.has(change.key),
      );
      const written = await commit(connectionId, batch, { durable: true, extraChanges });
      ports.onServerRows(connectionId, {
        kind: "merge",
        removedThreadIds: removedThreadIds(connectionId, batch),
        rows: batch.admitted,
      });
      await written?.checkpoint;
    });
  };

  /**
   * Replaces the connection's rows with a native full snapshot at `cursor`.
   * Rows a push changed after `cursor` and rows outside the global snapshot
   * (pins, children, started shells) survive.
   */
  const applySnapshot = async (
    connectionId: string,
    snapshots: readonly SyncSnapshotThread[],
    cursor: number,
  ): Promise<void> => {
    // An unreadable snapshot (an older stored checkpoint) is skipped whole.
    const parsed = parseThreadListRows(snapshots.map((snapshot) => snapshot.thread));
    if (parsed.status === "error") {
      appLogger.warn({
        event: "thread_summary.snapshot_rows.invalid",
        fields: { connectionId, rowCount: snapshots.length },
      });
      return;
    }
    const rows = parsed.value;
    await writes.run(async () => {
      if (ports.disposed()) {
        return;
      }
      const batch = emptyBatch(await storage.loadConnectionRows(connectionId));
      const retainedThreadIds = new Set<string>();
      const listed = new Set<string>();
      for (const row of rows) {
        listed.add(row.threadId);
        stageRow(connectionId, batch, row);
        if (!batch.changed.has(threadSummaryKey(connectionId, row.threadId))) {
          retainedThreadIds.add(row.threadId);
        }
      }
      stageSnapshotRemovals(connectionId, batch, { cursor, listed, retained: retainedThreadIds });
      const written = await commit(connectionId, batch, { durable: true });
      ports.onServerRows(connectionId, {
        kind: "replace",
        retainedThreadIds,
        rows: batch.admitted,
      });
      await written?.checkpoint;
    });
  };

  return { applyCatalogPage, applyServerRows, applySnapshot };
}
