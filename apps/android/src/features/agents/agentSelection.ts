/** V1 agentSelection owner, extracted without changing interaction or resource lifetime. */
import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { subagentDisplayName } from "../../data/subagent-projection";
import type { StoredThreadSummary } from "../../data/thread-summary-types";
import type { ThreadListItem } from "../threadList/threadListTypes";

export const SUBAGENT_LIST_LIMIT = 200;

export function subagentThreadListItem(
  summary: StoredThreadSummary,
  thread: Thread,
  connectionId: string,
): ThreadListItem {
  return {
    id: thread.id,
    serverId: connectionId,
    title: subagentDisplayName(summary),
    preview: summary.preview,
    timestamp: summary.recencyAt ?? summary.updatedAt,
    pinned: false,
    archived: false,
    unread: summary.unread,
    ...(summary.status.type === "active"
      ? { state: "running" as const }
      : summary.status.type === "systemError"
        ? { state: "failed" as const }
        : {}),
  };
}

import { SubagentListProjection } from "../../data/subagent-projection";
import type { ThreadSummaryDatabase } from "../../data/thread-summary-database";
import { useEvent } from "../../react/useEvent";
import { useConversationState } from "../../ui/use-conversation-scope";

/** Keep one projection per mounted qualified conversation and read the retained summary view. */
export function useAgentSelection(
  composerScope: string,
  subagentSummaryDatabase: ThreadSummaryDatabase | null,
  draftConnectionId: string | null,
  draftThreadId: string | null,
) {
  const [subagentEventProjection] = useConversationState(
    composerScope,
    () => new SubagentListProjection(),
  );
  const currentSubagentSummaries = useEvent((): readonly StoredThreadSummary[] => {
    if (subagentSummaryDatabase === null || draftConnectionId === null || draftThreadId === null)
      return [];
    const resource = subagentSummaryDatabase.viewResource({
      viewId: `subagents:${draftConnectionId}:${draftThreadId}`,
      connectionId: null,
      recentLimit: 0,
      archivedLimit: 0,
      selectedConnectionId: null,
      selectedThreadId: null,
      subagentConnectionId: draftConnectionId,
      subagentLimit: SUBAGENT_LIST_LIMIT,
    });
    return subagentEventProjection.project(resource.view$.peek().subagents);
  });
  return currentSubagentSummaries;
}
