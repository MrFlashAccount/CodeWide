import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";
import { useThreadSummaryView } from "../../data/use-thread-summary-view";
import { useEvent } from "../../react/useEvent";
import { ALL_SERVERS_ID } from "../navigation/serverSelection";
import { ThreadListProjection } from "./summaryProjection";
import { THREAD_LIST_PAGE_SIZE, type ThreadListMode } from "./threadListModel";
import {
  deduplicateThreadSummaries,
  ThreadListItemProjection,
  ThreadListScopeProjection,
} from "./threadListProjection";
import type { ThreadListSources } from "./threadListSources";
/** Stable projections and page admission use the existing catalog resource. */
export function useThreadListWorkspace(
  remote: ThreadListSources,
  activeServerId: string,
  threadListMode: ThreadListMode,
  threadListLimit: number,
  setThreadListLimit: Dispatch<SetStateAction<number>>,
) {
  const [threadListProjection] = useState(() => new ThreadListProjection());

  const [threadListItemProjection] = useState(() => new ThreadListItemProjection());

  const [threadListScopeProjection] = useState(() => new ThreadListScopeProjection());

  const threadConnectionId =
    activeServerId === ALL_SERVERS_ID || activeServerId === "" ? null : activeServerId;

  const threadSummaryView = useThreadSummaryView(remote.threadSummaryDatabase, {
    connectionId: threadConnectionId,
    recentLimit: threadListMode === "active" ? threadListLimit : 0,
    archivedLimit: threadListMode === "archived" ? threadListLimit : 0,
    selectedConnectionId: null,
    selectedThreadId: null,
    subagentConnectionId: null,
    subagentLimit: 0,
  });

  const pinnedThreadSummaryRows = threadSummaryView?.pinned ?? [];

  const recentThreadSummaryRows = threadSummaryView?.recent ?? [];

  const archivedThreadSummaryRows = threadSummaryView?.archived ?? [];

  const loadedThreadSummaries = deduplicateThreadSummaries([
    ...pinnedThreadSummaryRows,
    ...recentThreadSummaryRows,
    ...archivedThreadSummaryRows,
  ]);

  const projectedThreadSummaries = threadListProjection.project(
    loadedThreadSummaries,
    remote.pendingRequests,
  );

  const threads = threadListItemProjection.project(projectedThreadSummaries);

  const threadScope = threadListScopeProjection.project(threads, activeServerId);

  const scopedThreads = threadScope.scoped;

  const serverThreads = threadScope.active;

  const archivedThreads = threadScope.archived;

  const loadMoreThreads = useEvent(() => {
    const loadedCount =
      threadListMode === "archived"
        ? archivedThreadSummaryRows.length
        : recentThreadSummaryRows.length + pinnedThreadSummaryRows.length;
    if (loadedCount < threadListLimit) return;
    setThreadListLimit((current) => current + THREAD_LIST_PAGE_SIZE);
  });
  return {
    threadSummaryView,
    loadedThreadSummaries,
    scopedThreads,
    serverThreads,
    archivedThreads,
    loadMoreThreads,
  };
}
