import type { Dispatch, SetStateAction } from "react";
import { useState } from "react";
import { useThreadSummaryView } from "../../data/use-thread-summary-view";
import { useEvent } from "../../react/useEvent";
import { serverScopeConnectionId, type ServerScope } from "../../services/servers/serverScope";
import { threadSelectionKey } from "../../services/threads/threadRouteParams";
import { ThreadListProjection } from "./summaryProjection";
import { THREAD_LIST_PAGE_SIZE, type ThreadListMode } from "./threadListModel";
import {
  deduplicateThreadSummaries,
  ThreadListItemProjection,
  ThreadListScopeProjection,
} from "./threadListProjection";
import type { ThreadListSources } from "./threadListSources";
import type { ThreadListItem } from "./threadListTypes";
/** Stable projections and page admission use the existing catalog resource. */
export function useThreadListWorkspace(
  remote: ThreadListSources,
  serverScope: ServerScope,
  threadListMode: ThreadListMode,
  threadListLimit: number,
  setThreadListLimit: Dispatch<SetStateAction<number>>,
) {
  const [threadListProjection] = useState(() => new ThreadListProjection());

  const [threadListItemProjection] = useState(() => new ThreadListItemProjection());

  const [threadListScopeProjection] = useState(() => new ThreadListScopeProjection());

  const threadConnectionId = serverScopeConnectionId(serverScope);

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

  const threadScope = threadListScopeProjection.project(threads, serverScope);

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

/** Selects the initial desktop row until the user chooses a server or thread explicitly. */
export function defaultDesktopThreadSelection(
  desktop: boolean,
  enabled: boolean,
  threads: readonly ThreadListItem[],
): string | null {
  const first = threads[0];
  return desktop && enabled && first !== undefined ? threadSelectionKey(first) : null;
}
