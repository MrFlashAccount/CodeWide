import type { useThreadListActions } from "../../src/features/threadList/threadListActions";
import type { ThreadListSources } from "../../src/features/threadList/threadListSources";
import { WorkspaceThreadList } from "../../src/features/workspace/WorkspaceThreadList";
import type { useWorkspaceListBindings } from "../../src/features/workspace/workspaceListBindings";
import type { useWorkspaceProjectBindings } from "../../src/features/workspace/workspaceProjectBindings";
import type { GlobalVoiceControl } from "../../src/features/threadList/GlobalVoiceEntryAction";

type V1WorkspaceThreadListProps = {
  readonly createSidebarThread: () => void;
  readonly desktop: boolean;
  readonly globalVoice: GlobalVoiceControl;
  readonly list: ReturnType<typeof useWorkspaceListBindings>;
  readonly listActions: ReturnType<typeof useThreadListActions>;
  readonly openGlobalSearch: () => void;
  readonly openProjects: () => void;
  readonly openSettings: () => void;
  readonly openTerminals: () => void;
  readonly project: ReturnType<typeof useWorkspaceProjectBindings>;
  readonly refreshThreadListAccountRateLimits: () => Promise<void>;
  readonly sidebarSearch: React.JSX.Element | null;
  readonly threadListSources: ThreadListSources;
  readonly viewportWidth: number;
};

/** Adapts mounted route resources to the shared V1 thread-list presentation. */
export function V1WorkspaceThreadList(props: V1WorkspaceThreadListProps): React.JSX.Element {
  const { list, listActions, project } = props;
  return (
    <WorkspaceThreadList
      archivedThreads={list.archivedThreads}
      archiveListThread={listActions.archiveListThread}
      changeSidebarFilter={project.changeSidebarFilter}
      changeSidebarMode={project.changeSidebarMode}
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
      openSidebarProject={list.projectSelection.openSidebarProject}
      openTerminals={props.openTerminals}
      pinnedSidebarProjects={project.projectWorkspace.pinnedSidebarProjects}
      projectLimit={project.projectLimit}
      refreshThreadListAccountRateLimits={props.refreshThreadListAccountRateLimits}
      selectedThreadKey={list.selectedThreadKey}
      selectServer={list.selectServer}
      selectThread={list.selectThread}
      servers={list.servers}
      serverScope={list.serverScope}
      serverThreads={list.serverThreads}
      setMobileThreadQuery={list.listState.setMobileThreadQuery}
      sidebarCatalogState={project.sidebarCatalogState}
      sidebarFilter={project.sidebarFilter}
      sidebarMode={project.sidebarMode}
      sidebarProject={list.projectSelection.sidebarProject}
      sidebarScopeKey={project.sidebarScopeKey}
      sidebarSearch={props.sidebarSearch}
      threadListSources={props.threadListSources}
      toggleListThreadPin={listActions.toggleListThreadPin}
      unarchiveListThread={listActions.unarchiveListThread}
      viewportWidth={props.viewportWidth}
    />
  );
}
