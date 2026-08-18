import type { PendingServerRequest } from "./pending-request-types";
import { projectThreadHotStates } from "./thread-hot-state";
import type { StoredThreadSummary } from "./thread-summary-types";

/**
 * Keeps the immutable thread index referentially stable while unrelated live
 * queries (for example the active turn stream) re-render the workspace. The
 * list can then reject unchanged rows in O(1) instead of rematerializing every
 * visible thread on each stream flush.
 */
export class ThreadListProjection {
  private summaries: readonly StoredThreadSummary[] | null = null;
  private pendingRequests: readonly PendingServerRequest[] | null = null;
  private value: StoredThreadSummary[] = [];

  project(
    summaries: readonly StoredThreadSummary[],
    pendingRequests: readonly PendingServerRequest[],
  ): StoredThreadSummary[] {
    if (summaries === this.summaries && pendingRequests === this.pendingRequests) return this.value;
    this.summaries = summaries;
    this.pendingRequests = pendingRequests;
    this.value = projectThreadHotStates(
      summaries.filter((thread) => thread.deleteCommandId == null && thread.parentThreadId == null),
      pendingRequests,
    ).sort(compareThreadSummaryRecency);
    return this.value;
  }
}

function compareThreadSummaryRecency(left: StoredThreadSummary, right: StoredThreadSummary): number {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
  const leftRecency = left.recencyAt ?? left.updatedAt;
  const rightRecency = right.recencyAt ?? right.updatedAt;
  if (leftRecency !== rightRecency) return rightRecency - leftRecency;
  return left.remoteThreadId.localeCompare(right.remoteThreadId);
}
