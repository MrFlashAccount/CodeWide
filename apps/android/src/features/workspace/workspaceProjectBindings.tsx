import { workspaceRuntime } from "../../data/workspace-runtime";
import { useNewChatVisibility } from "../projects/newChat";
import { ProjectPickerFeature } from "../projects/ProjectPickerFeature";
import { useProjectWorkspace } from "../projects/projectWorkspace";
import { GlobalSearchScreen } from "../search/GlobalSearchScreen";
import { useThreadSearch } from "../search/threadSearch";
import { useProjectThreadList } from "../threadList/projectThreadList";
import { sidebarListState } from "../threadList/SidebarListFeedback";
import { workspaceFeatures as features } from "./createWorkspaceFeatures";
import { useWorkspaceListBindings } from "./workspaceListBindings";
import type { WorkspaceContentProps } from "./WorkspaceScreen.types";

/** Binds existing scoped owners in their original hook order; owns no replacement state. */
export function useWorkspaceProjectBindings({
  list,
  connections,
  runtime,
  newThreadVisible,
}: {
  list: ReturnType<typeof useWorkspaceListBindings>;
  connections: WorkspaceContentProps["connections"];
  runtime: WorkspaceContentProps["runtime"];
  newThreadVisible: ReturnType<typeof useNewChatVisibility>[0];
}) {
  const threadSearch = useThreadSearch(
    workspaceRuntime.native,
    features.search.searchThreads,
    list.activeServerId,
    list.projectSelection.sidebarProject,
    list.listState.mobileThreadQuery,
    list.serverThreads,
    list.archivedThreads,
  );
  const projectWorkspace = useProjectWorkspace(
    {
      native: workspaceRuntime.native,
      connections: connections,
      threadSummaryDatabase: runtime.threadSummaries,
      listProjects: features.projects.listProjects,
      addProject: features.projects.addProject,
      setProjectPinned: features.projects.setProjectPinned,
    },
    list.servers,
    list.activeServerId,
    newThreadVisible,
    list.searchVisible,
  );
  const sidebarSearch = list.searchVisible ? (
    <GlobalSearchScreen
      remote={{ searchMessages: features.search.searchMessages }}
      servers={list.servers}
      threads={list.scopedThreads}
      projects={projectWorkspace.searchProjects}
      session={list.searchSession}
      onClose={list.closeGlobalSearch}
      onOpenThread={list.openSearchThread}
    />
  ) : null;
  const sidebarCatalogState = sidebarListState(
    !workspaceRuntime.native || list.servers.length === 0 ? "ready" : list.threadSummaryView?.phase,
    list.threadSummaryView?.error ?? null,
    projectWorkspace.sidebarServers.some(
      (server) => server.status === "connecting" || server.status === "syncing",
    ),
  );
  const projectManagementSheet = (
    <ProjectPickerFeature
      projectsSheetVisible={list.projectSelection.projectsSheetVisible}
      projectDirectoryServerId={list.projectSelection.projectDirectoryServerId}
      availableSidebarProjects={projectWorkspace.availableSidebarProjects}
      sidebarServers={projectWorkspace.sidebarServers}
      sidebarProjectErrors={projectWorkspace.sidebarProjectErrors}
      toggleSidebarProject={projectWorkspace.toggleSidebarProject}
      moveSidebarProject={projectWorkspace.moveSidebarProject}
      setProjectDirectoryServerId={list.projectSelection.setProjectDirectoryServerId}
      setProjectsSheetVisible={list.projectSelection.setProjectsSheetVisible}
      addSidebarProject={projectWorkspace.addSidebarProject}
      readDirectory={features.projects.readDirectory}
      readProjectHome={features.projects.readProjectHome}
    />
  );
  const {
    sidebarMode,
    changeSidebarMode,
    sidebarFilter,
    changeSidebarFilter,
    sidebarScopeKey,
    projectLimit,
    loadMoreProjectThreads,
  } = useProjectThreadList(
    list.activeServerId,
    list.projectSelection.sidebarProject,
    list.listState.threadListMode,
    list.listState.setThreadListMode,
    list.listState.threadListFilter,
    list.listState.setThreadListFilter,
    list.projectListState.projectListMode,
    list.projectListState.setProjectListMode,
    list.projectListState.projectListFilter,
    list.projectListState.setProjectListFilter,
    list.projectListState.projectListLimits,
    list.projectListState.setProjectListLimits,
  );
  return {
    threadSearch,
    projectWorkspace,
    sidebarSearch,
    sidebarCatalogState,
    projectManagementSheet,
    sidebarMode,
    changeSidebarMode,
    sidebarFilter,
    changeSidebarFilter,
    sidebarScopeKey,
    projectLimit,
    loadMoreProjectThreads,
  };
}
