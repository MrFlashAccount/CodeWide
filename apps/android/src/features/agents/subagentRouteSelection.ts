import type { StoredThreadSummary } from "../../data/thread-summary-types";

/** Route-owned selection state for the responsive V1 subagent workspace. */
export type SubagentRouteSelection =
  | { readonly status: "master" }
  | { readonly status: "selected"; readonly threadId: string }
  | { readonly status: "invalid" };

/** Validated subagent selection after matching the current retained projection. */
export type ResolvedSubagentRouteSelection =
  | { readonly status: "master" }
  | { readonly status: "unavailable" }
  | { readonly status: "selected"; readonly summary: StoredThreadSummary };

/** Rejects invalid and unknown detail ids without converting them into the master state. */
export function resolveSubagentRouteSelection(
  subagents: readonly StoredThreadSummary[],
  selection: SubagentRouteSelection,
): ResolvedSubagentRouteSelection {
  if (selection.status === "master") {
    return selection;
  }
  if (selection.status === "invalid") {
    return { status: "unavailable" };
  }
  const summary = subagents.find((candidate) => candidate.remoteThreadId === selection.threadId);
  return summary === undefined ? { status: "unavailable" } : { status: "selected", summary };
}
