import type { StoredThreadSummary } from "./thread-summary-types";

export type ThreadSummaryViewRequest = {
  /** Independent presentation owner; list and detail ranges must not replace each other. */
  viewId?: string;
  connectionId: string | null;
  /** Exact Companion project directory; omitted for the global catalog. */
  projectCwd?: string;
  recentLimit: number;
  archivedLimit: number;
  selectedConnectionId: string | null;
  selectedThreadId: string | null;
  subagentConnectionId: string | null;
  subagentLimit: number;
};

/** Ordered partitions published atomically by a thread summary view. */
export type LoadedThreadSummaryView = {
  pinned: readonly StoredThreadSummary[];
  recent: readonly StoredThreadSummary[];
  archived: readonly StoredThreadSummary[];
  selected: readonly StoredThreadSummary[];
  subagents: readonly StoredThreadSummary[];
};
