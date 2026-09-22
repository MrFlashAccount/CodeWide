import { effectiveThreadListFilter } from "../features/threadList/threadListFilters";
import type { useThreadListActions } from "../features/threadList/threadListActions";
import type { ThreadListSources } from "../features/threadList/threadListSources";
import { WorkspaceThreadList } from "../features/workspace/WorkspaceThreadList";
import type { useWorkspaceListBindings } from "../features/workspace/workspaceListBindings";
import type { useWorkspaceProjectBindings } from "../features/workspace/workspaceProjectBindings";
import type { GlobalVoiceControl } from "../features/threadList/GlobalVoiceEntryAction";
import type { SidebarProject } from "../features/projects/sidebarProjects";

type WorkspaceRouteThreadListProps = {
  readonly createSidebarThread: () => void;
  readonly desktop: boolean;
  readonly globalVoice: GlobalVoiceControl;
  readonly list: ReturnType<typeof useWorkspaceListBindings>;
  readonly listActions: ReturnType<typeof useThreadListActions>;
  readonly openGlobalSearch: () => void;
  readonly openProjects: () => void;
  readonly openSettings: () => void;
  readonly openSidebarProject: (project: SidebarProject) => void;
  readonly openTerminals: () => void;
  readonly project: ReturnType<typeof useWorkspaceProjectBindings>;
  readonly refreshThreadListAccountRateLimits: () => Promise<void>;
  readonly sidebarSearch: React.JSX.Element | null;
  readonly threadListSources: ThreadListSources;
  readonly viewportWidth: number;
};

/** Adapts mounted route resources to the shared V1 thread-list presentation. */
export function WorkspaceRouteThreadList(props: WorkspaceRouteThreadListProps): React.JSX.Element {
  const { list, listActions, project } = props;
  return (
    <WorkspaceThreadList
      archivedThreads={list.archivedThreads}
      archiveListThread={listActions.archiveListThread}
      changeSidebarFilter={list.listState.setThreadListFilter}
      changeSidebarMode={list.listState.setThreadListMode}
      closeSidebarProject={list.projectSelection.closeSidebarProject}
      createSidebarThread={props.createSidebarThread}
      desktop={props.desktop}
      globalVoice={props.globalVoice}
      loadMoreProjectThreads={project.loadMoreProjectThreads}
      loadMoreThreads={list.loadMoreThreads}
      markListThreadRead={listActions.markListThreadRead}
      mobileRemoteSearchResource={project.threadSearch.mobileRemoteSearchResource}
      mobileThreadOffset={list.listState.mobileThreadOffset}
      mobileThreadQuery={list.listState.mobileThreadQuery}
      mobileVisibleArchivedThreads={project.threadSearch.mobileVisibleArchivedThreads}
      mobileVisibleThreads={project.threadSearch.mobileVisibleThreads}
      normalizedMobileThreadQuery={project.threadSearch.normalizedMobileThreadQuery}
      openGlobalSearch={props.openGlobalSearch}
      openProjects={props.openProjects}
      openSettings={props.openSettings}
      openSidebarProject={props.openSidebarProject}
      openTerminals={props.openTerminals}
      pinnedSidebarProjects={project.projectWorkspace.pinnedSidebarProjects}
      projectLimit={project.projectLimit}
      refreshThreadListAccountRateLimits={props.refreshThreadListAccountRateLimits}
      selectedThreadKey={list.selectedThreadKey}
      selectServer={list.selectServer}
      servers={list.servers}
      serverScope={list.serverScope}
      serverThreads={list.serverThreads}
      setMobileThreadQuery={list.listState.setMobileThreadQuery}
      sidebarCatalogState={project.sidebarCatalogState}
      sidebarFilter={effectiveThreadListFilter(
        list.listState.threadListMode,
        list.listState.threadListFilter,
      )}
      sidebarMode={list.listState.threadListMode}
      sidebarProject={null}
      sidebarScopeKey={`${list.serverScope.kind === "all" ? "all" : `connection:${list.serverScope.connectionId}`}:${list.listState.threadListMode}`}
      sidebarSearch={props.sidebarSearch}
      threadListSources={props.threadListSources}
      threadNavigation={list}
      toggleListThreadPin={listActions.toggleListThreadPin}
      unarchiveListThread={listActions.unarchiveListThread}
      viewportWidth={props.viewportWidth}
    />
  );
}
