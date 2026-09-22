import type { Dispatch, SetStateAction } from "react";
import { useThreadSummaryView } from "../../data/use-thread-summary-view";
import { useConstant } from "../../react/useConstant";
import { useThreadListPageRequest } from "./threadListPageRequest";
import { serverScopeConnectionId, type ServerScope } from "../../services/servers/serverScope";
import { ThreadListProjection } from "./summaryProjection";
import type { ThreadListMode } from "./threadListModel";
import {
  deduplicateThreadSummaries,
  ThreadListItemProjection,
  ThreadListScopeProjection,
} from "./threadListProjection";
import type { ThreadListSources } from "./threadListSources";
/** Stable projections and page admission use the existing catalog resource. */
export function useThreadListWorkspace(
  remote: ThreadListSources,
  serverScope: ServerScope,
  threadListMode: ThreadListMode,
  threadListLimit: number,
  setThreadListLimit: Dispatch<SetStateAction<number>>,
) {
  const threadListProjection = useConstant(() => new ThreadListProjection());

  const threadListItemProjection = useConstant(() => new ThreadListItemProjection());

  const threadListScopeProjection = useConstant(() => new ThreadListScopeProjection());

  const threadConnectionId = serverScopeConnectionId(serverScope);

  const request = {
    archivedLimit: threadListMode === "archived" ? threadListLimit : 0,
    connectionId: threadConnectionId,
    recentLimit: threadListMode === "active" ? threadListLimit : 0,
    selectedConnectionId: null,
    selectedThreadId: null,
    subagentConnectionId: null,
    subagentLimit: 0,
  };
  const loadMoreThreads = useThreadListPageRequest(
    remote.threadSummaryDatabase,
    request,
    setThreadListLimit,
  );
  const threadSummaryView = useThreadSummaryView(remote.threadSummaryDatabase, request);

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

  return {
    archivedThreads,
    loadedThreadSummaries,
    loadMoreThreads,
    scopedThreads,
    serverThreads,
    threadSummaryView,
  };
}
