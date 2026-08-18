import type { PendingServerRequest } from "./pending-request-types";
import type { StoredThreadSummary } from "./thread-summary-types";

/**
 * Joins the immutable thread index with the small mutable approval head.
 * Screens consume this projection instead of independently deciding whether a
 * thread is running, unread, or waiting for the user.
 */
export function projectThreadHotStates(
  summaries: readonly StoredThreadSummary[],
  pendingRequests: readonly PendingServerRequest[],
): StoredThreadSummary[] {
  const counts = new Map<string, number>();
  for (const request of pendingRequests) {
    const threadId = typeof request.params.threadId === "string" ? request.params.threadId : null;
    if (threadId === null) continue;
    const key = `${request.connectionId}\u0000${threadId}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return summaries.map((summary) => {
    const count = counts.get(`${summary.connectionId}\u0000${summary.remoteThreadId}`) ?? 0;
    return summary.pendingRequestCount === count ? summary : { ...summary, pendingRequestCount: count };
  });
}
