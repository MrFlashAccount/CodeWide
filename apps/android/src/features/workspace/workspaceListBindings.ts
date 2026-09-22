import type { StoredConnection } from "../../data/connection-profile-types";
import { useConstant } from "../../react/useConstant";
import { useServerScope } from "../../services/servers/serverScope";
import {
  useThreadNavigationService,
  type V1ThreadRouter,
} from "../../services/threads/threadNavigationService";
import { threadSelectionKey } from "../../services/threads/threadRouteParams";
import { ThreadServerProjection } from "../connections/connectionPresentation";
import type { ProjectSelection } from "../projects/projectSelection";
import { THREAD_LIST_PAGE_SIZE } from "../threadList/threadListModel";
import type { ThreadListSources } from "../threadList/threadListSources";
import { useProjectListState, useThreadListState } from "../threadList/threadListState";
import { useThreadListWorkspace } from "../threadList/threadListWorkspace";
import { workspaceFeatures as features } from "./createWorkspaceFeatures";
import type { WorkspaceBindingContext } from "./workspaceBindingContract";

/** Binds V1 list owners to Router intents while keeping server scope separate from destinations. */
// WHY: Downstream bindings derive this cohesive hook contract with ReturnType so it keeps one source of truth.
// oxlint-disable-next-line typescript/explicit-module-boundary-types
export function useWorkspaceListBindings({
  connections,
  projectSelection,
  threadListSources,
  threadRouter,
}: {
  connections: WorkspaceBindingContext["connections"];
  projectSelection: ProjectSelection;
  threadListSources: ThreadListSources;
  threadRouter: V1ThreadRouter;
}) {
  const listState = useThreadListState();
  const projectListState = useProjectListState();
  const serverProjection = useConstant(() => new ThreadServerProjection());
  const servers = serverProjection.project(connections);
  const server = useServerScope(connections, () => {
    listState.setThreadListLimit(THREAD_LIST_PAGE_SIZE);
  });
  const settingsConnections: StoredConnection[] = connections;
  const {
    archivedThreads,
    loadedThreadSummaries,
    loadMoreThreads,
    scopedThreads,
    serverThreads,
    threadSummaryView,
  } = useThreadListWorkspace(
    threadListSources,
    server.scope,
    listState.threadListMode,
    listState.threadListLimit,
    listState.setThreadListLimit,
  );
  const navigation = useThreadNavigationService(
    {
      observeThread: features.conversation.observeThread,
      searchConversation: features.search.searchConversation,
    },
    threadRouter,
  );
  const selectedThreadKey =
    threadRouter.currentThread === null
      ? null
      : threadSelectionKey({
          id: threadRouter.currentThread.threadId.value,
          serverId: threadRouter.currentThread.connectionId.value,
        });
  return {
    archivedThreads,
    listState,
    loadedThreadSummaries,
    loadMoreThreads,
    projectListState,
    projectSelection,
    scopedThreads,
    selectedThreadKey,
    selectServer: server.select,
    servers,
    serverScope: server.scope,
    serverThreads,
    settingsConnections,
    threadSummaryView,
    ...navigation,
  };
}
