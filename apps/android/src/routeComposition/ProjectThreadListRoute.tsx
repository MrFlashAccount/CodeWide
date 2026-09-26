import type { SidebarProject } from "../features/projects/sidebarProjects";
import { ThreadListFeature } from "../features/threadList/ThreadListFeature";
import { projectThreadListKey } from "../features/threadList/projectThreadList";
import { effectiveThreadListFilter } from "../features/threadList/threadListFilters";
import { THREAD_LIST_PAGE_SIZE } from "../features/threadList/threadListModel";
import { useEvent } from "../react/useEvent";
import { useWorkspaceRouteResources } from "../services/workspace/workspaceRouteResources";
import { useWorkspaceListRouteResources } from "./workspaceListRouteResources";

/** Presents project content below the persistent catalog header. */
export function ProjectThreadListRoute({
  project,
}: {
  readonly project: SidebarProject;
}): React.JSX.Element {
  const resources = useWorkspaceListRouteResources();
  const workspace = useWorkspaceRouteResources();
  const state = resources.list.projectListState;
  const mode = state.projectListMode;
  const scopeKey = projectThreadListKey(project, mode);
  const close = resources.list.projectSelection.closeSidebarProject;
  const createThread = useEvent((): void => {
    workspace.openNewThread(project.connectionId, project.path);
  });
  const loadMoreProject = useEvent((limit: number): void => {
    state.setProjectListLimits((limits) => ({
      ...limits,
      [scopeKey]: Math.max(limits[scopeKey] ?? THREAD_LIST_PAGE_SIZE, limit),
    }));
  });
  const offset = resources.list.listState.mobileThreadOffset;
  const changeOffset = useEvent((value: number): void => {
    offset.write(scopeKey, value);
  });
  const changeQuery = useEvent((): void => undefined);
  return (
    <ThreadListFeature
      onDismiss={close}
      scopeKey={scopeKey}
      view={{
        mode: "mobile",
        props: {
          archivedThreads: [],
          catalogState: { status: "loading" },
          filter: effectiveThreadListFilter(mode, state.projectListFilter),
          globalVoice: resources.globalVoice,
          headerVisible: false,
          initialOffset: offset.read(scopeKey),
          mode,
          onArchive: resources.listActions.archiveListThread,
          onBackToProjects: close,
          onFilterChange: state.setProjectListFilter,
          onLoadMore: resources.list.loadMoreThreads,
          onLoadMoreProject: loadMoreProject,
          onManageProjects: resources.openProjects,
          onManageTerminals: resources.openTerminals,
          onModeChange: state.setProjectListMode,
          onNewThread: createThread,
          onOffsetChange: changeOffset,
          onOpenProject: resources.openSidebarProject,
          onOpenSearch: resources.openGlobalSearch,
          onQueryChange: changeQuery,
          onRefreshAccountRateLimits: resources.refreshThreadListAccountRateLimits,
          onSelectServer: resources.list.selectServer,
          onSettings: resources.openSettings,
          onTogglePin: resources.listActions.toggleListThreadPin,
          onToggleRead: resources.listActions.toggleListThreadRead,
          onUnarchive: resources.listActions.unarchiveListThread,
          project,
          projectLimit: state.projectListLimits[scopeKey] ?? THREAD_LIST_PAGE_SIZE,
          projects: [],
          query: "",
          remote: resources.threadListSources,
          searchContent: null,
          selectedThreadKey: resources.desktop ? resources.list.selectedThreadKey : null,
          servers: resources.list.servers,
          serverScope: { connectionId: project.connectionId, kind: "connection" },
          threadNavigation: resources.list,
          threads: [],
        },
      }}
    />
  );
}
