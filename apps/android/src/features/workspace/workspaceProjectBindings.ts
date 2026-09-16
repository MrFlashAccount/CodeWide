import { workspaceRuntime } from "../../data/workspace-runtime";
import { useProjectWorkspace } from "../projects/projectWorkspace";
import { useThreadSearch } from "../search/threadSearch";
import { useProjectThreadList } from "../threadList/projectThreadList";
import { sidebarListState } from "../threadList/SidebarListFeedback";
import { workspaceFeatures as features } from "./createWorkspaceFeatures";
import type { useWorkspaceListBindings } from "./workspaceListBindings";
import type { WorkspaceBindingContext } from "./workspaceBindingContract";

/** Project, search, and sidebar bindings consumed by mounted V1 workspace routes. */
export type WorkspaceProjectBindings = {
  readonly changeSidebarFilter: ReturnType<typeof useProjectThreadList>["changeSidebarFilter"];
  readonly changeSidebarMode: ReturnType<typeof useProjectThreadList>["changeSidebarMode"];
  readonly loadMoreProjectThreads: ReturnType<
    typeof useProjectThreadList
  >["loadMoreProjectThreads"];
  readonly projectLimit: ReturnType<typeof useProjectThreadList>["projectLimit"];
  readonly projectWorkspace: ReturnType<typeof useProjectWorkspace>;
  readonly sidebarCatalogState: ReturnType<typeof sidebarListState>;
  readonly sidebarFilter: ReturnType<typeof useProjectThreadList>["sidebarFilter"];
  readonly sidebarMode: ReturnType<typeof useProjectThreadList>["sidebarMode"];
  readonly sidebarScopeKey: ReturnType<typeof useProjectThreadList>["sidebarScopeKey"];
  readonly threadSearch: ReturnType<typeof useThreadSearch>;
};

const searchThreads = features.search.searchThreads.bind(features.search);
const addProject = features.projects.addProject.bind(features.projects);
const listProjects = features.projects.listProjects.bind(features.projects);
const setProjectPinned = features.projects.setProjectPinned.bind(features.projects);

/** Binds list and project resources while Router owns Search and project destinations. */
export function useWorkspaceProjectBindings({
  connections,
  list,
  newThreadActive,
  runtime,
  searchActive,
}: {
  connections: WorkspaceBindingContext["connections"];
  list: ReturnType<typeof useWorkspaceListBindings>;
  newThreadActive: boolean;
  runtime: WorkspaceBindingContext["runtime"];
  searchActive: boolean;
}): WorkspaceProjectBindings {
  const threadSearch = useThreadSearch(
    workspaceRuntime.native,
    searchThreads,
    list.serverScope,
    list.projectSelection.sidebarProject,
    list.listState.mobileThreadQuery,
    list.serverThreads,
    list.archivedThreads,
  );
  const projectWorkspace = useProjectWorkspace(
    {
      addProject,
      connections,
      listProjects,
      native: workspaceRuntime.native,
      setProjectPinned,
      threadSummaryDatabase: runtime.threadSummaries,
    },
    list.servers,
    list.serverScope,
    newThreadActive,
    searchActive,
  );
  const sidebarCatalogState = sidebarListState(
    !workspaceRuntime.native || list.servers.length === 0 ? "ready" : list.threadSummaryView?.phase,
    list.threadSummaryView?.error ?? null,
    projectWorkspace.sidebarServers.some(
      (server) => server.status === "connecting" || server.status === "syncing",
    ),
  );
  const scopeKey =
    list.serverScope.kind === "all" ? "all" : `connection:${list.serverScope.connectionId}`;
  const {
    changeSidebarFilter,
    changeSidebarMode,
    loadMoreProjectThreads,
    projectLimit,
    sidebarFilter,
    sidebarMode,
    sidebarScopeKey,
  } = useProjectThreadList(
    scopeKey,
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
    changeSidebarFilter,
    changeSidebarMode,
    loadMoreProjectThreads,
    projectLimit,
    projectWorkspace,
    sidebarCatalogState,
    sidebarFilter,
    sidebarMode,
    sidebarScopeKey,
    threadSearch,
  };
}
