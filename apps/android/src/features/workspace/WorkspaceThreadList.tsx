import { ThreadListFeature } from "../threadList/ThreadListFeature";
import type { ThreadSidebarProps } from "../threadList/ThreadSidebarContract";
import type { useThreadListState } from "../threadList/threadListState";
import type { useThreadSearch } from "../search/threadSearch";
import { sidebarListState } from "../threadList/SidebarListFeedback";
import { desktopThreadSidebarWidth } from "../../presentation/layouts/windowLayout";
/** Binds the shared list capabilities to their desktop or mobile presentation. */
export function WorkspaceThreadList({
  archivedThreads,
  archiveListThread,
  changeSidebarFilter,
  changeSidebarMode,
  closeSidebarProject,
  createSidebarThread,
  desktop,
  globalVoice,
  loadMoreProjectThreads,
  loadMoreThreads,
  markListThreadRead,
  mobileRemoteSearchResource,
  mobileThreadOffset,
  mobileThreadQuery,
  mobileVisibleArchivedThreads,
  mobileVisibleThreads,
  normalizedMobileThreadQuery,
  openGlobalSearch,
  openProjects,
  openSettings,
  openSidebarProject,
  openTerminals,
  pinnedSidebarProjects,
  projectLimit,
  refreshThreadListAccountRateLimits,
  selectedThreadKey,
  selectServer,
  selectThread,
  servers,
  serverScope,
  serverThreads,
  setMobileThreadQuery,
  sidebarCatalogState,
  sidebarFilter,
  sidebarMode,
  sidebarProject,
  sidebarScopeKey,
  sidebarSearch,
  threadListSources,
  toggleListThreadPin,
  unarchiveListThread,
  viewportWidth,
}: {
  archivedThreads: ThreadSidebarProps["archivedThreads"];
  archiveListThread: ThreadSidebarProps["onArchive"];
  changeSidebarFilter: ThreadSidebarProps["onFilterChange"];
  changeSidebarMode: ThreadSidebarProps["onModeChange"];
  closeSidebarProject: ThreadSidebarProps["onBackToProjects"];
  createSidebarThread: ThreadSidebarProps["onNewThread"];
  desktop: boolean;
  globalVoice: ThreadSidebarProps["globalVoice"];
  loadMoreProjectThreads: ThreadSidebarProps["onLoadMoreProject"];
  loadMoreThreads: ThreadSidebarProps["onLoadMore"];
  markListThreadRead: ThreadSidebarProps["onMarkRead"];
  mobileRemoteSearchResource: ReturnType<typeof useThreadSearch>["mobileRemoteSearchResource"];
  mobileThreadOffset: ReturnType<typeof useThreadListState>["mobileThreadOffset"];
  mobileThreadQuery: string;
  mobileVisibleArchivedThreads: ThreadSidebarProps["archivedThreads"];
  mobileVisibleThreads: ThreadSidebarProps["threads"];
  normalizedMobileThreadQuery: string;
  openGlobalSearch: ThreadSidebarProps["onOpenSearch"];
  openProjects: () => void;
  openSettings: () => void;
  openSidebarProject: ThreadSidebarProps["onOpenProject"];
  openTerminals: () => void;
  pinnedSidebarProjects: ThreadSidebarProps["projects"];
  projectLimit: ThreadSidebarProps["projectLimit"];
  refreshThreadListAccountRateLimits: NonNullable<ThreadSidebarProps["onRefreshAccountRateLimits"]>;
  selectedThreadKey: ThreadSidebarProps["selectedThreadKey"];
  selectServer: ThreadSidebarProps["onSelectServer"];
  selectThread: ThreadSidebarProps["onSelect"];
  servers: ThreadSidebarProps["servers"];
  serverScope: ThreadSidebarProps["serverScope"];
  serverThreads: ThreadSidebarProps["threads"];
  setMobileThreadQuery: (query: string) => void;
  sidebarCatalogState: ThreadSidebarProps["catalogState"];
  sidebarFilter: ThreadSidebarProps["filter"];
  sidebarMode: ThreadSidebarProps["mode"];
  sidebarProject: ThreadSidebarProps["project"];
  sidebarScopeKey: string;
  sidebarSearch: ThreadSidebarProps["searchContent"];
  threadListSources: ThreadSidebarProps["remote"];
  toggleListThreadPin: ThreadSidebarProps["onTogglePin"];
  unarchiveListThread: ThreadSidebarProps["onUnarchive"];
  viewportWidth: number;
}): React.JSX.Element {
  return (
    <ThreadListFeature
      scopeKey={sidebarScopeKey}
      {...(sidebarProject === null ? {} : { onDismiss: closeSidebarProject })}
      view={
        desktop
          ? {
              mode: "desktop",
              props: {
                archivedThreads: archivedThreads,
                catalogState:
                  normalizedMobileThreadQuery === ""
                    ? sidebarCatalogState
                    : sidebarListState(
                        mobileRemoteSearchResource.status,
                        mobileRemoteSearchResource.error,
                        false,
                      ),
                filter: sidebarFilter,
                globalVoice,
                initialOffset: mobileThreadOffset.read(sidebarScopeKey),
                mode: sidebarMode,
                onArchive: archiveListThread,
                onBackToProjects: closeSidebarProject,
                onFilterChange: changeSidebarFilter,
                onLoadMore: loadMoreThreads,
                onLoadMoreProject: loadMoreProjectThreads,
                onManageProjects: openProjects,
                onManageTerminals: openTerminals,
                onMarkRead: markListThreadRead,
                onModeChange: changeSidebarMode,
                onNewThread: createSidebarThread,
                onOffsetChange: (offset) => {
                  mobileThreadOffset.write(sidebarScopeKey, offset);
                },
                onOpenProject: openSidebarProject,
                onOpenSearch: openGlobalSearch,
                onRefreshAccountRateLimits: refreshThreadListAccountRateLimits,
                onSelect: selectThread,
                onSelectServer: selectServer,
                onSettings: openSettings,
                onTogglePin: toggleListThreadPin,
                onUnarchive: unarchiveListThread,
                project: sidebarProject,
                projectLimit: projectLimit,
                projects: pinnedSidebarProjects,
                remote: threadListSources,
                searchContent: sidebarSearch,
                selectedThreadKey,
                servers: servers,
                serverScope,
                threads: serverThreads,
                width: desktopThreadSidebarWidth(viewportWidth),
              },
            }
          : {
              mode: "mobile",
              props: {
                archivedThreads: mobileVisibleArchivedThreads,
                catalogState: sidebarCatalogState,
                filter: sidebarFilter,
                globalVoice,
                initialOffset: mobileThreadOffset.read(sidebarScopeKey),
                mode: sidebarMode,
                onArchive: archiveListThread,
                onBackToProjects: closeSidebarProject,
                onFilterChange: changeSidebarFilter,
                onLoadMore: loadMoreThreads,
                onLoadMoreProject: loadMoreProjectThreads,
                onManageProjects: openProjects,
                onManageTerminals: openTerminals,
                onMarkRead: markListThreadRead,
                onModeChange: changeSidebarMode,
                onNewThread: createSidebarThread,
                onOffsetChange: (offset) => {
                  mobileThreadOffset.write(sidebarScopeKey, offset);
                },
                onOpenProject: openSidebarProject,
                onOpenSearch: openGlobalSearch,
                onQueryChange: setMobileThreadQuery,
                onRefreshAccountRateLimits: refreshThreadListAccountRateLimits,
                onSelectServer: selectServer,
                onSelectThread: selectThread,
                onSettings: openSettings,
                onTogglePin: toggleListThreadPin,
                onUnarchive: unarchiveListThread,
                project: sidebarProject,
                projectLimit: projectLimit,
                projects: pinnedSidebarProjects,
                query: mobileThreadQuery,
                remote: threadListSources,
                searchContent: sidebarSearch,
                servers: servers,
                serverScope,
                threads: mobileVisibleThreads,
              },
            }
      }
    />
  );
}
