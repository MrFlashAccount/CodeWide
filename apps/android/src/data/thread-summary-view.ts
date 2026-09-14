import { replaceEqualDeep } from "./replace-equal-deep";
import { threadSummaryKey } from "./thread-summary-projection";
import type { StoredThreadSummary } from "./thread-summary-types";
import type { LoadedThreadSummaryView, ThreadSummaryViewRequest } from "./thread-summary-model";

type Partition = keyof LoadedThreadSummaryView;
type SummaryChange = { type: "insert" | "update"; value: StoredThreadSummary } | { type: "delete"; key: string };

/** Membership and ordering are shared by initial reads and incremental updates. */
function includesRow(partition: Partition, row: StoredThreadSummary, request: ThreadSummaryViewRequest): boolean {
  if (partition === "selected") return row.connectionId === request.selectedConnectionId && row.remoteThreadId === request.selectedThreadId;
  if (partition === "subagents") return row.connectionId === request.subagentConnectionId && row.parentThreadId !== null && row.deleteCommandId === null;
  if (row.parentThreadId !== null || row.deleteCommandId !== null
    || (request.connectionId !== null && row.connectionId !== request.connectionId)
    || (request.projectCwd !== undefined && row.cwd !== request.projectCwd)) return false;
  if (partition === "pinned") return !row.archived && row.pinned;
  if (partition === "recent") return !row.archived && !row.pinned;
  return row.archived;
}

function limitFor(partition: Partition, request: ThreadSummaryViewRequest): number {
  if (partition === "pinned") return Infinity;
  if (partition === "recent") return request.recentLimit;
  if (partition === "archived") return request.archivedLimit;
  if (partition === "selected") return request.selectedThreadId === null ? 0 : 1;
  return request.subagentLimit;
}

function compare(partition: Partition, left: StoredThreadSummary, right: StoredThreadSummary): number {
  return (partition === "archived" ? Number(right.pinned) - Number(left.pinned) : 0)
    || (right.recencyAt ?? right.updatedAt) - (left.recencyAt ?? left.updatedAt)
    || threadSummaryKey(left.connectionId, left.remoteThreadId).localeCompare(threadSummaryKey(right.connectionId, right.remoteThreadId));
}

function projectPartition(rows: readonly StoredThreadSummary[], partition: Partition, request: ThreadSummaryViewRequest): StoredThreadSummary[] {
  const result = rows.filter((row) => includesRow(partition, row, request));
  if (partition !== "selected") result.sort((left, right) => compare(partition, left, right));
  const limit = limitFor(partition, request);
  if (result.length > limit) result.length = limit;
  return result;
}

export function projectThreadSummaryView(rows: readonly StoredThreadSummary[], request: ThreadSummaryViewRequest): LoadedThreadSummaryView {
  return {
    pinned: projectPartition(rows, "pinned", request),
    recent: projectPartition(rows, "recent", request),
    archived: projectPartition(rows, "archived", request),
    selected: projectPartition(rows, "selected", request),
    subagents: projectPartition(rows, "subagents", request),
  };
}

function insertionIndex(rows: readonly StoredThreadSummary[], value: StoredThreadSummary, partition: Partition): number {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const row = rows[middle];
    if (row !== undefined && compare(partition, row, value) < 0) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Retains untouched arrays/rows; copies only a partition whose published value changes. */
function updatePartition(
  previous: readonly StoredThreadSummary[], changes: readonly SummaryChange[],
  partition: Partition, request: ThreadSummaryViewRequest,
): { rows: readonly StoredThreadSummary[]; removed: boolean } {
  const limit = limitFor(partition, request);
  if (limit === 0 && previous.length === 0) return { rows: previous, removed: false };
  let result: StoredThreadSummary[] | null = null;
  let removed = false;
  for (const change of changes) {
    const rows = result ?? previous;
    const key = change.type === "delete" ? change.key : threadSummaryKey(change.value.connectionId, change.value.remoteThreadId);
    const index = rows.findIndex((row) => threadSummaryKey(row.connectionId, row.remoteThreadId) === key);
    if (change.type === "delete" || !includesRow(partition, change.value, request)) {
      if (index < 0) continue;
      result ??= previous.slice();
      result.splice(index, 1);
      removed = true;
      continue;
    }
    const old = rows[index];
    const value = old === undefined ? change.value : replaceEqualDeep(old, change.value);
    if (value === old) continue;
    if (index >= 0) {
      // A lowered rank can expose a candidate retained only by another range
      // (for example the selected chat outside the recent limit).
      if (old !== undefined && compare(partition, old, value) < 0) removed = true;
      const left = rows[index - 1];
      const right = rows[index + 1];
      if ((left === undefined || compare(partition, left, value) <= 0)
        && (right === undefined || compare(partition, value, right) <= 0)) {
        result ??= previous.slice();
        result[index] = value;
        continue;
      }
      result ??= previous.slice();
      result.splice(index, 1);
    }
    const destination = insertionIndex(result ?? previous, value, partition);
    if (destination >= limit && changes.length === 1) continue;
    result ??= previous.slice();
    result.splice(destination, 0, value);
  }
  if (result !== null && result.length > limit) result.length = limit;
  return { rows: result ?? previous, removed };
}

/** Rebuilds membership after removals, including candidates retained in another partition. */
export function reprojectThreadSummaryChanges(previous: LoadedThreadSummaryView, changes: readonly SummaryChange[], request: ThreadSummaryViewRequest): LoadedThreadSummaryView {
  const residents = new Map<string, StoredThreadSummary>();
  for (const partition of [previous.pinned, previous.recent, previous.archived, previous.selected, previous.subagents]) {
    for (const row of partition) residents.set(threadSummaryKey(row.connectionId, row.remoteThreadId), row);
  }
  for (const change of changes) {
    if (change.type === "delete") residents.delete(change.key);
    else residents.set(threadSummaryKey(change.value.connectionId, change.value.remoteThreadId), change.value);
  }
  return projectThreadSummaryView([...residents.values()], request);
}

/** Applies a delta without rebuilding maps or sorting unrelated resident rows. */
export function updateThreadSummaryView(previous: LoadedThreadSummaryView, changes: readonly SummaryChange[], request: ThreadSummaryViewRequest): LoadedThreadSummaryView {
  const pinned = updatePartition(previous.pinned, changes, "pinned", request);
  const recent = updatePartition(previous.recent, changes, "recent", request);
  const archived = updatePartition(previous.archived, changes, "archived", request);
  const selected = updatePartition(previous.selected, changes, "selected", request);
  const subagents = updatePartition(previous.subagents, changes, "subagents", request);
  if (pinned.removed || recent.removed || archived.removed || selected.removed || subagents.removed) {
    const rebuilt = reprojectThreadSummaryChanges(previous, changes, request);
    return {
      pinned: replaceEqualDeep(previous.pinned, rebuilt.pinned),
      recent: replaceEqualDeep(previous.recent, rebuilt.recent),
      archived: replaceEqualDeep(previous.archived, rebuilt.archived),
      selected: replaceEqualDeep(previous.selected, rebuilt.selected),
      subagents: replaceEqualDeep(previous.subagents, rebuilt.subagents),
    };
  }
  return { pinned: pinned.rows, recent: recent.rows, archived: archived.rows, selected: selected.rows, subagents: subagents.rows };
}
