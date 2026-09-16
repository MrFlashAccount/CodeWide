import type { StoredThreadSummary } from "./thread-summary-types";

export type ThreadSummaryViewRequest = {
  archivedLimit: number;
  connectionId: string | null;
  /** Exact Companion project directory; omitted for the global catalog. */
  projectCwd?: string;
  recentLimit: number;
  selectedConnectionId: string | null;
  selectedThreadId: string | null;
  subagentConnectionId: string | null;
  subagentLimit: number;
  /** Independent presentation owner; list and detail ranges must not replace each other. */
  viewId?: string;
};

/** Ordered partitions published atomically by a thread summary view. */
export type LoadedThreadSummaryView = {
  archived: readonly StoredThreadSummary[];
  pinned: readonly StoredThreadSummary[];
  recent: readonly StoredThreadSummary[];
  selected: readonly StoredThreadSummary[];
  subagents: readonly StoredThreadSummary[];
};
