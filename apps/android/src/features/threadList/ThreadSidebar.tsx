import type { ThreadSidebarProps } from "./ThreadSidebarContract";
import { ThreadSidebarHeader } from "./ThreadSidebarHeader";
import { useThreadListViewportPaging } from "./threadListViewportPaging";
import { LegendList } from "@legendapp/list/react-native";
import { useState } from "react";
import { Animated, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Reanimated from "react-native-reanimated";
import { usePerformanceExperiment } from "../../data/performance-experiments";
import { threadSelectionKey } from "../../services/threads/threadRouteParams";
import { NewThreadFloatingButton } from "../projects/NewThreadFloatingButton";
import { SidebarProjectRow } from "../projects/SidebarProjects";
import { SelectableThreadRow } from "./SelectableThreadRow";
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
import { styles } from "./ThreadSidebar.styles";

const SCROLL_EVENT_THROTTLE_MS = 16;

export function ThreadSidebar(props: ThreadSidebarProps) {
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
    remote,
    searchContent,
    selectedThreadKey,
    servers,
    serverScope,
    threadNavigation,
    threads,
    width,
  } = props;

  const projectSource = useProjectSidebarThreads(
    remote,
    project,
    mode,
    projectLimit,
    onLoadMoreProject,
  );
  const hideThreadLists = usePerformanceExperiment("hideThreadLists");
  const [query, setQuery] = useState("");
  const filtered = (project === null ? threads : projectSource.threads).filter((thread) =>
    threadMatchesFilter(thread, filter),
  );
  const filteredArchived = (project === null ? archivedThreads : projectSource.threads).filter(
    (thread) =>
      threadMatchesFilter(thread, filter) &&
      `${thread.title} ${thread.preview}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const rows = sidebarRows(
    mode === "archived" ? filteredArchived : filtered,
    projects,
    mode === "archived" ? "archive" : project === null ? "global" : "project",
  );
  const listKey = `${serverScope.kind === "all" ? "all" : serverScope.connectionId}:${mode}:${project?.key ?? "global"}`;
  const scroll = useThreadListScrollController(rows, listKey, {
    keyFor: sidebarRowKey,
    onOffsetChange,
  });
  const paging = useThreadListViewportPaging(
    listKey,
    project === null ? onLoadMore : projectSource.loadMore,
  );
  const pullSearch = useThreadListPullGesture(props.onOpenSearch, initialOffset, listKey);

  return (
    <View style={[styles.threadSidebar, { width }]} testID="thread-list-pane">
      {props.headerVisible === false ? null : (
        <ThreadSidebarHeader props={props} setQuery={setQuery} />
      )}
      <View style={styles.threadListContentSurface}>
        <ThreadListRouteTransition routeKey={searchContent === null ? "list" : "search"}>
          {searchContent ??
            (hideThreadLists ? (
              <View style={styles.threadListSuspended}>
                <ThreadListExperimentSuspended />
              </View>
            ) : (
              <Reanimated.View style={styles.threadListSuspended}>
                <LegendList
                  data={scroll.rows}
                  dataKey={`desktop-threads:${serverScope.kind === "all" ? "all" : serverScope.connectionId}:${mode}:${project?.key ?? "global"}`}
                  drawDistance={320}
                  extraData={selectedThreadKey}
                  getFixedItemSize={threadListRowHeight}
                  getItemType={(row) => row.kind}
                  initialScrollOffset={initialOffset}
                  itemsAreEqual={threadListRowsEqual}
                  key={listKey}
                  keyboardShouldPersistTaps="handled"
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
                          setQuery("");
                          onOpenProject(item.project);
                        }}
                        project={item.project}
                      />
                    ) : (
                      <SelectableThreadRow
                        link={threadNavigation.getThreadLink(item.thread)}
                        onArchive={async () => onArchive(item.thread)}
                        onMarkRead={async () => onMarkRead(item.thread)}
                        onNavigate={() => {
                          threadNavigation.prepareThreadLink(threadSelectionKey(item.thread));
                        }}
                        onTogglePin={async () => onTogglePin(item.thread)}
                        onUnarchive={async () => onUnarchive(item.thread)}
                        selectedThreadKey={selectedThreadKey}
                        server={
                          serverScope.kind === "all" && servers.length > 1
                            ? servers.find((entry) => entry.id === item.thread.serverId)
                            : undefined
                        }
                        thread={item.thread}
                      />
                    )
                  }
                  renderScrollComponent={(scrollViewProps) => (
                    <GestureDetector gesture={pullSearch.gesture}>
                      <Animated.ScrollView {...scrollViewProps} />
                    </GestureDetector>
                  )}
                  scrollEventThrottle={SCROLL_EVENT_THROTTLE_MS}
                  testID="desktop-thread-list"
                />
              </Reanimated.View>
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
