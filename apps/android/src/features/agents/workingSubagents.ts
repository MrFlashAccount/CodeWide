import { SubagentListProjection, subagentsForThread } from "../../data/subagent-projection";
import type { ThreadSummaryDatabase } from "../../data/thread-summary-database";
import type { StoredThreadSummary } from "../../data/thread-summary-types";
import { useThreadSummaryView } from "../../data/use-thread-summary-view";
import { useConstant } from "../../react/useConstant";
import { SUBAGENT_LIST_LIMIT } from "./agentSelection";

/** A thread's subagents as its child threads report them. */
export type ThreadSubagents = {
  /** The projected subagent catalog the subagents workspace opens with. */
  readonly catalog: readonly StoredThreadSummary[];
  /** How many subagents descend from the thread. */
  readonly total: number;
  /** The descendants whose own thread is running now. */
  readonly working: readonly StoredThreadSummary[];
};

/**
 * Reads a thread's subagents without suspending: the live status chip must
 * not hold the conversation back while the summary view loads.
 */
export function useThreadSubagents({
  connectionId,
  database,
  enabled,
  parentThreadId,
}: {
  readonly connectionId: string | null;
  readonly database: ThreadSummaryDatabase | null;
  /** Whether this conversation shows subagents at all. */
  readonly enabled: boolean;
  readonly parentThreadId: string | null;
}): ThreadSubagents {
  const request =
    !enabled || connectionId === null || parentThreadId === null
      ? null
      : {
          archivedLimit: 0,
          connectionId: null,
          recentLimit: 0,
          selectedConnectionId: null,
          selectedThreadId: null,
          subagentConnectionId: connectionId,
          subagentLimit: SUBAGENT_LIST_LIMIT,
          viewId: `subagents:${connectionId}:${parentThreadId}`,
        };
  const view = useThreadSummaryView(database, request, false);
  const projection = useConstant(() => new SubagentListProjection());
  const catalog = projection.project(view?.subagents ?? []);
  const descendants = parentThreadId === null ? [] : subagentsForThread(catalog, parentThreadId);
  return {
    catalog,
    total: descendants.length,
    working: descendants.filter((summary) => summary.status.type === "active"),
  };
}
