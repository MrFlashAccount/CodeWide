import type { StoredThreadSummary } from "../data/thread-summary-types";
import type { LinkedThreadDescription } from "../features/pullRequestDetail/overview/LinkedThreadsCard";

/**
 * Resolves a linked thread's title and activity from the loaded thread
 * catalog. Threads outside the loaded window are described as `null` and the
 * PR screen falls back to their link source.
 */
export function useLinkedThreadDescriptions(
  summaries: readonly StoredThreadSummary[],
): (connectionId: string, threadId: string) => LinkedThreadDescription | null {
  return (connectionId, threadId) => {
    const summary = summaries.find(
      (candidate) =>
        candidate.connectionId === connectionId && candidate.remoteThreadId === threadId,
    );
    if (summary === undefined) {
      return null;
    }
    return {
      status:
        summary.status.type === "active"
          ? "Working"
          : summary.status.type === "idle"
            ? "Idle"
            : "Not loaded",
      title: summary.name ?? (summary.preview.length > 0 ? summary.preview : "Untitled thread"),
    };
  };
}
