import type { MobileThreadsProps } from "./MobileThreadsContract";
import { MobileThreadsHeader } from "./MobileThreadsHeader";
import { useThreadListViewportPaging } from "./threadListViewportPaging";
import { LegendList } from "@legendapp/list/react-native";
import { View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Reanimated from "react-native-reanimated";
import { usePerformanceExperiment } from "../../data/performance-experiments";
import { threadSelectionKey } from "../../services/threads/threadRouteParams";
import { NewThreadFloatingButton } from "../projects/NewThreadFloatingButton";
import { SidebarProjectRow } from "../projects/SidebarProjects";
import { styles } from "./MobileThreads.styles";
import { SidebarListFeedback } from "./SidebarListFeedback";
import { sidebarRows } from "./sidebarRows";
import { SidebarSectionHeader } from "./SidebarSectionHeader";
import { ThreadListExperimentSuspended } from "./ThreadListBoundary";
import { ThreadListRouteTransition } from "./ThreadListRouteTransition";
import { ThreadListPullBackdrop } from "./ThreadListPullBackdrop";
import { threadMatchesFilter } from "./threadListFilters";
import { useThreadListPullGesture } from "./threadListSearchPull";
import {
  sidebarRowKey,
  threadListRowHeight,
  threadListRowsEqual,
  useProjectSidebarThreads,
} from "./threadListModel";
import {
  THREAD_LIST_VISIBLE_CONTENT_POSITION,
  useThreadListScrollController,
} from "./threadListScroll";
import { ThreadRow } from "./ThreadRow";

const SCROLL_EVENT_THROTTLE_MS = 16;

export function MobileThreads(props: MobileThreadsProps) {
  const {
    archivedThreads,
    catalogState,
    filter,
    initialOffset,
    mode,
    onArchive,
    onLoadMore,
    onLoadMoreProject,
    onMarkRead,
    onNewThread,
    onOffsetChange,
    onOpenProject,
    onTogglePin,
    onUnarchive,
    project,
    projectLimit,
    projects,
    query,
    remote,
    searchContent,
    servers,
    serverScope,
    threadNavigation,
    threads,
  } = props;

  const projectSource = useProjectSidebarThreads(
    remote,
    project,
    mode,
    projectLimit,
    onLoadMoreProject,
  );
  const hideThreadLists = usePerformanceExperiment("hideThreadLists");
  const filteredThreads = (project === null ? threads : projectSource.threads).filter(
    (thread) =>
      threadMatchesFilter(thread, filter) &&
      `${thread.title} ${thread.preview}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const filteredArchived = (project === null ? archivedThreads : projectSource.threads).filter(
    (thread) =>
      threadMatchesFilter(thread, filter) &&
      `${thread.title} ${thread.preview}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const mobileRows = sidebarRows(
    mode === "archived" ? filteredArchived : filteredThreads,
    projects,
    mode === "archived" ? "archive" : project === null ? "global" : "project",
  );
  const listKey = `${serverScope.kind === "all" ? "all" : serverScope.connectionId}:${mode}:${project?.key ?? "global"}`;
  const scroll = useThreadListScrollController(mobileRows, listKey, {
    keyFor: sidebarRowKey,
    onOffsetChange,
  });
  const paging = useThreadListViewportPaging(
    listKey,
    project === null ? onLoadMore : projectSource.loadMore,
  );
  const pullSearch = useThreadListPullGesture(props.onOpenSearch);

  return (
    <View style={[styles.mobileList, searchContent !== null && styles.searchOverlayList]}>
      {props.headerVisible !== false && <MobileThreadsHeader props={props} />}
      <View style={styles.threadListContentSurface}>
        <ThreadListRouteTransition routeKey={searchContent === null ? "list" : "search"}>
          {searchContent ??
            (hideThreadLists ? (
              <View style={styles.threadListSuspended}>
                <ThreadListExperimentSuspended />
              </View>
            ) : (
              <GestureDetector gesture={pullSearch.gesture}>
                <Reanimated.View style={styles.threadListSuspended}>
                  <LegendList
                    data={scroll.rows}
                    dataKey={`mobile-threads:${serverScope.kind === "all" ? "all" : serverScope.connectionId}:${mode}:${project?.key ?? "global"}`}
                    drawDistance={320}
                    extraData={props.selectedThreadKey}
                    getFixedItemSize={threadListRowHeight}
                    getItemType={(item) => item.kind}
                    initialScrollOffset={initialOffset}
                    itemsAreEqual={threadListRowsEqual}
                    key={listKey}
                    keyExtractor={sidebarRowKey}
                    ListEmptyComponent={
                      <SidebarListFeedback
                        archived={mode === "archived"}
                        key={`${serverScope.kind === "all" ? "all" : serverScope.connectionId}:${mode}:${query}:${project?.key ?? "global"}`}
                        state={project === null ? catalogState : projectSource.state}
                      />
                    }
                    ListFooterComponent={
                      scroll.rows.length > 0 &&
                      mode === "active" &&
                      !scroll.rows.some((row) => row.kind === "thread") ? (
                        <SidebarListFeedback
                          archived={false}
                          key={`${serverScope.kind === "all" ? "all" : serverScope.connectionId}:${mode}:${query}:${project?.key ?? "global"}`}
                          state={project === null ? catalogState : projectSource.state}
                        />
                      ) : null
                    }
                    maintainVisibleContentPosition={THREAD_LIST_VISIBLE_CONTENT_POSITION}
                    onContentSizeChange={paging.onContentSizeChange}
                    onEndReached={paging.onEndReached}
                    onEndReachedThreshold={0.4}
                    onLayout={paging.onLayout}
                    onMomentumScrollBegin={scroll.onMomentumScrollBegin}
                    onMomentumScrollEnd={scroll.onMomentumScrollEnd}
                    onScroll={pullSearch.onScroll}
                    onScrollBeginDrag={scroll.onScrollBeginDrag}
                    onScrollEndDrag={scroll.onScrollEndDrag}
                    recycleItems
                    renderItem={({ item }) =>
                      item.kind === "header" ? (
                        <SidebarSectionHeader title={item.title} />
                      ) : item.kind === "project" ? (
                        <SidebarProjectRow
                          onPress={() => {
                            onOpenProject(item.project);
                          }}
                          project={item.project}
                        />
                      ) : (
                        <ThreadRow
                          link={threadNavigation.getThreadLink(item.thread)}
                          onArchive={async () => onArchive(item.thread)}
                          onMarkRead={async () => onMarkRead(item.thread)}
                          onNavigate={() => {
                            threadNavigation.prepareThreadLink(threadSelectionKey(item.thread));
                          }}
                          onTogglePin={async () => onTogglePin(item.thread)}
                          onUnarchive={async () => onUnarchive(item.thread)}
                          selected={props.selectedThreadKey === threadSelectionKey(item.thread)}
                          server={
                            serverScope.kind === "all" && servers.length > 1
                              ? servers.find((entry) => entry.id === item.thread.serverId)
                              : undefined
                          }
                          thread={item.thread}
                        />
                      )
                    }
                    scrollEventThrottle={SCROLL_EVENT_THROTTLE_MS}
                  />
                </Reanimated.View>
              </GestureDetector>
            ))}
        </ThreadListRouteTransition>
        {searchContent === null && <ThreadListPullBackdrop />}
      </View>
      {searchContent === null && mode === "active" && (
        <NewThreadFloatingButton onPress={onNewThread} projectName={project?.name ?? null} />
      )}
    </View>
  );
}
