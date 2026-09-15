import { ThreadListFeature } from "../threadList/ThreadListFeature";
import type { ThreadSidebarProps } from "../threadList/ThreadSidebarContract";
import type { useThreadListState } from "../threadList/threadListState";
import type { useThreadSearch } from "../search/threadSearch";
import { sidebarListState } from "../threadList/SidebarListFeedback";
import { desktopThreadSidebarWidth } from "../../presentation/layouts/windowLayout";
/** Binds the shared list capabilities to their desktop or mobile presentation. */
export function WorkspaceThreadList({
  threadListSources,
  projectLimit,
  loadMoreProjectThreads,
  sidebarProject,
  pinnedSidebarProjects,
  openSidebarProject,
  closeSidebarProject,
  sidebarCatalogState,
  servers,
  activeServerId,
  serverThreads,
  archivedThreads,
  sidebarMode,
  sidebarFilter,
  threadNavigation,
  changeSidebarMode,
  changeSidebarFilter,
  loadMoreThreads,
  selectThread,
  openGlobalSearch,
  sidebarSearch,
  preloadThread,
  selectServer,
  createSidebarThread,
  toggleListThreadPin,
  archiveListThread,
  unarchiveListThread,
  markListThreadRead,
  refreshThreadListAccountRateLimits,
  mobileVisibleThreads,
  mobileVisibleArchivedThreads,
  desktop,
  viewportWidth,
  sidebarScopeKey,
  mobileThreadOffset,
  setProjectsSheetVisible,
  setSettingsVisible,
  normalizedMobileThreadQuery,
  mobileRemoteSearchResource,
  mobileThreadQuery,
  setMobileThreadQuery,
}: {
  threadListSources: ThreadSidebarProps["remote"];
  projectLimit: ThreadSidebarProps["projectLimit"];
  loadMoreProjectThreads: ThreadSidebarProps["onLoadMoreProject"];
  sidebarProject: ThreadSidebarProps["project"];
  pinnedSidebarProjects: ThreadSidebarProps["projects"];
  openSidebarProject: ThreadSidebarProps["onOpenProject"];
  closeSidebarProject: ThreadSidebarProps["onBackToProjects"];
  sidebarCatalogState: ThreadSidebarProps["catalogState"];
  servers: ThreadSidebarProps["servers"];
  activeServerId: ThreadSidebarProps["activeServerId"];
  serverThreads: ThreadSidebarProps["threads"];
  archivedThreads: ThreadSidebarProps["archivedThreads"];
  sidebarMode: ThreadSidebarProps["mode"];
  sidebarFilter: ThreadSidebarProps["filter"];
  threadNavigation: ThreadSidebarProps["navigation"];
  changeSidebarMode: ThreadSidebarProps["onModeChange"];
  changeSidebarFilter: ThreadSidebarProps["onFilterChange"];
  loadMoreThreads: ThreadSidebarProps["onLoadMore"];
  selectThread: ThreadSidebarProps["onSelect"];
  openGlobalSearch: ThreadSidebarProps["onOpenSearch"];
  sidebarSearch: ThreadSidebarProps["searchContent"];
  preloadThread: ThreadSidebarProps["onPreload"];
  selectServer: ThreadSidebarProps["onSelectServer"];
  createSidebarThread: ThreadSidebarProps["onNewThread"];
  toggleListThreadPin: ThreadSidebarProps["onTogglePin"];
  archiveListThread: ThreadSidebarProps["onArchive"];
  unarchiveListThread: ThreadSidebarProps["onUnarchive"];
  markListThreadRead: ThreadSidebarProps["onMarkRead"];
  refreshThreadListAccountRateLimits: NonNullable<ThreadSidebarProps["onRefreshAccountRateLimits"]>;
  mobileVisibleThreads: ThreadSidebarProps["threads"];
  mobileVisibleArchivedThreads: ThreadSidebarProps["archivedThreads"];
  desktop: boolean;
  viewportWidth: number;
  sidebarScopeKey: string;
  mobileThreadOffset: ReturnType<typeof useThreadListState>["mobileThreadOffset"];
  setProjectsSheetVisible: (visible: boolean) => void;
  setSettingsVisible: (visible: boolean) => void;
  normalizedMobileThreadQuery: string;
  mobileRemoteSearchResource: ReturnType<typeof useThreadSearch>["mobileRemoteSearchResource"];
  mobileThreadQuery: string;
  setMobileThreadQuery: (query: string) => void;
}) {
  return (
    <ThreadListFeature
      scopeKey={sidebarScopeKey}
      {...(sidebarProject === null ? {} : { onDismiss: closeSidebarProject })}
      view={
        desktop
          ? {
              mode: "desktop",
              props: {
                remote: threadListSources,
                projectLimit: projectLimit,
                onLoadMoreProject: loadMoreProjectThreads,
                initialOffset: mobileThreadOffset.read(sidebarScopeKey),
                onOffsetChange: (offset) => mobileThreadOffset.write(sidebarScopeKey, offset),
                project: sidebarProject,
                projects: pinnedSidebarProjects,
                onOpenProject: openSidebarProject,
                onBackToProjects: closeSidebarProject,
                onManageProjects: () => setProjectsSheetVisible(true),
                catalogState:
                  normalizedMobileThreadQuery === ""
                    ? sidebarCatalogState
                    : sidebarListState(
                        mobileRemoteSearchResource.status,
                        mobileRemoteSearchResource.error,
                        false,
                      ),
                width: desktopThreadSidebarWidth(viewportWidth),
                servers: servers,
                activeServerId: activeServerId,
                threads: serverThreads,
                archivedThreads: archivedThreads,
                mode: sidebarMode,
                filter: sidebarFilter,
                navigation: threadNavigation,
                onModeChange: changeSidebarMode,
                onFilterChange: changeSidebarFilter,
                onLoadMore: loadMoreThreads,
                onSelect: selectThread,
                onOpenSearch: openGlobalSearch,
                searchContent: sidebarSearch,
                onPreload: preloadThread,
                onSelectServer: selectServer,
                onSettings: () => setSettingsVisible(true),
                onNewThread: createSidebarThread,
                onTogglePin: toggleListThreadPin,
                onArchive: archiveListThread,
                onUnarchive: unarchiveListThread,
                onMarkRead: markListThreadRead,
                onRefreshAccountRateLimits: refreshThreadListAccountRateLimits,
              },
            }
          : {
              mode: "mobile",
              props: {
                remote: threadListSources,
                projectLimit: projectLimit,
                onLoadMoreProject: loadMoreProjectThreads,
                project: sidebarProject,
                projects: pinnedSidebarProjects,
                onOpenProject: openSidebarProject,
                onBackToProjects: closeSidebarProject,
                onManageProjects: () => setProjectsSheetVisible(true),
                catalogState: sidebarCatalogState,
                servers: servers,
                activeServerId: activeServerId,
                threads: mobileVisibleThreads,
                archivedThreads: mobileVisibleArchivedThreads,
                mode: sidebarMode,
                filter: sidebarFilter,
                query: mobileThreadQuery,
                onQueryChange: setMobileThreadQuery,
                onOpenSearch: openGlobalSearch,
                searchContent: sidebarSearch,
                onModeChange: changeSidebarMode,
                onFilterChange: changeSidebarFilter,
                onLoadMore: loadMoreThreads,
                initialOffset: mobileThreadOffset.read(sidebarScopeKey),
                onOffsetChange: (offset) => mobileThreadOffset.write(sidebarScopeKey, offset),
                onSelectThread: selectThread,
                onPreloadThread: preloadThread,
                onSelectServer: selectServer,
                onNewThread: createSidebarThread,
                onTogglePin: toggleListThreadPin,
                onArchive: archiveListThread,
                onUnarchive: unarchiveListThread,
                onMarkRead: markListThreadRead,
                onSettings: () => setSettingsVisible(true),
                onRefreshAccountRateLimits: refreshThreadListAccountRateLimits,
              },
            }
      }
    />
  );
}
