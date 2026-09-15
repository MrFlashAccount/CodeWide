import type { StoredConnection } from "../../data/connection-profile-types";
import { workspaceRuntime } from "../../data/workspace-runtime";
import { useThreadNavigationActions } from "../navigation/navigationActions";
import { defaultDesktopThreadSelection, useServerSelection } from "../navigation/serverSelection";
import { useProjectSelection } from "../projects/projectSelection";
import { useSearchWorkspace } from "../search/searchWorkspace";
import { THREAD_LIST_PAGE_SIZE } from "../threadList/threadListModel";
import type { ThreadListSources } from "../threadList/threadListSources";
import { useProjectListState, useThreadListState } from "../threadList/threadListState";
import { useThreadListWorkspace } from "../threadList/threadListWorkspace";
import { workspaceFeatures as features } from "./createWorkspaceFeatures";
import type { WorkspaceContentProps } from "./WorkspaceScreen.types";

/** Binds existing scoped owners in their original hook order; owns no replacement state. */
export function useWorkspaceListBindings({
  connections,
  threadListSources,
  desktop,
  runtime,
  threadNavigation,
}: {
  connections: WorkspaceContentProps["connections"];
  threadListSources: ThreadListSources;
  desktop: WorkspaceContentProps["desktop"];
  runtime: WorkspaceContentProps["runtime"];
  threadNavigation: WorkspaceContentProps["threadNavigation"];
}) {
  const listState = useThreadListState();
  const projectListState = useProjectListState();
  const projectSelection = useProjectSelection(listState.setMobileThreadQuery, () =>
    projectListState.setProjectListMode("active"),
  );
  const { servers, activeServerId, setActiveServerId, desktopDefaultThreadEnabled, selectServer } =
    useServerSelection(connections, () => listState.setThreadListLimit(THREAD_LIST_PAGE_SIZE));
  const settingsConnections: StoredConnection[] = connections;
  const { searchSession, searchVisible, openGlobalSearch, closeGlobalSearch } =
    useSearchWorkspace();
  const {
    threadSummaryView,
    loadedThreadSummaries,
    scopedThreads,
    serverThreads,
    archivedThreads,
    loadMoreThreads,
  } = useThreadListWorkspace(
    threadListSources,
    activeServerId,
    listState.threadListMode,
    listState.threadListLimit,
    listState.setThreadListLimit,
  );
  const defaultDesktopThreadId = defaultDesktopThreadSelection(
    desktop,
    desktopDefaultThreadEnabled,
    serverThreads,
  );
  const { setActiveThreadId, selectThread, preloadThread, openSearchThread } =
    useThreadNavigationActions(
      {
        native: workspaceRuntime.native,
        threadDetails: runtime.threadDetails,
        threadUiStateDatabase: runtime.threadUiState,
        observeThread: features.conversation.observeThread,
        searchConversation: features.search.searchConversation,
      },
      threadNavigation,
      setActiveServerId,
    );
  return {
    listState,
    projectListState,
    projectSelection,
    servers,
    activeServerId,
    setActiveServerId,
    selectServer,
    settingsConnections,
    searchSession,
    searchVisible,
    openGlobalSearch,
    closeGlobalSearch,
    threadSummaryView,
    loadedThreadSummaries,
    scopedThreads,
    serverThreads,
    archivedThreads,
    loadMoreThreads,
    defaultDesktopThreadId,
    setActiveThreadId,
    selectThread,
    preloadThread,
    openSearchThread,
  };
}
