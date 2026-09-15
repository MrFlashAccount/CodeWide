import type { MobileThreadsProps } from "./MobileThreadsContract";
import { MobileThreadsHeader } from "./MobileThreadsHeader";
import { LegendList } from "@legendapp/list/react-native";
import { View } from "react-native";
import { usePerformanceExperiment } from "../../data/performance-experiments";
import { ALL_SERVERS_ID } from "../navigation/serverSelection";
import { threadSelectionKey } from "../navigation/threadSelection";
import { NewThreadFloatingButton } from "../projects/NewThreadFloatingButton";
import { SidebarProjectRow } from "../projects/SidebarProjects";
import { styles } from "./MobileThreads.styles";
import { SidebarListFeedback } from "./SidebarListFeedback";
import { sidebarRows } from "./sidebarRows";
import { SidebarSectionHeader } from "./SidebarSectionHeader";
import { ThreadListExperimentSuspended } from "./ThreadListBoundary";
import { threadMatchesFilter } from "./threadListFilters";
import {
  sidebarRowKey,
  threadListRowHeight,
  threadListRowsEqual,
  useProjectSidebarThreads,
} from "./threadListModel";
import { ThreadRow } from "./ThreadRow";

export function MobileThreads(props: MobileThreadsProps) {
  const {
    catalogState,
    remote,
    project,
    projects,
    onOpenProject,
    projectLimit,
    onLoadMoreProject,
    servers,
    activeServerId,
    threads,
    archivedThreads,
    mode,
    filter,
    query,
    searchContent,
    onLoadMore,
    initialOffset,
    onOffsetChange,
    onSelectThread,
    onPreloadThread,
    onNewThread,
    onTogglePin,
    onArchive,
    onUnarchive,
    onMarkRead,
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

  return (
    <View style={styles.mobileList}>
      <MobileThreadsHeader props={props} archivedCount={filteredArchived.length} />
      <View style={styles.threadListContentSurface}>
        {searchContent ??
          (hideThreadLists ? (
            <View style={styles.threadListSuspended}>
              <ThreadListExperimentSuspended />
            </View>
          ) : (
            <LegendList
              data={mobileRows}
              key={`${activeServerId}:${mode}:${project?.key ?? "global"}`}
              dataKey={`mobile-threads:${activeServerId}:${mode}:${project?.key ?? "global"}`}
              initialScrollOffset={initialOffset}
              getFixedItemSize={threadListRowHeight}
              drawDistance={320}
              recycleItems
              getItemType={(item) => item.kind}
              itemsAreEqual={threadListRowsEqual}
              onScroll={({ nativeEvent }) => onOffsetChange(nativeEvent.contentOffset.y)}
              onEndReached={project === null ? onLoadMore : projectSource.loadMore}
              onEndReachedThreshold={0.4}
              scrollEventThrottle={100}
              keyExtractor={sidebarRowKey}
              ListEmptyComponent={
                <SidebarListFeedback
                  key={`${activeServerId}:${mode}:${query}:${project?.key ?? "global"}`}
                  state={project === null ? catalogState : projectSource.state}
                  archived={mode === "archived"}
                />
              }
              ListFooterComponent={
                mobileRows.length > 0 && mode === "active" && filteredThreads.length === 0 ? (
                  <SidebarListFeedback
                    key={`${activeServerId}:${mode}:${query}:${project?.key ?? "global"}`}
                    state={project === null ? catalogState : projectSource.state}
                    archived={false}
                  />
                ) : null
              }
              renderItem={({ item }) =>
                item.kind === "header" ? (
                  <SidebarSectionHeader title={item.title} />
                ) : item.kind === "project" ? (
                  <SidebarProjectRow
                    project={item.project}
                    onPress={() => onOpenProject(item.project)}
                  />
                ) : (
                  <ThreadRow
                    thread={item.thread}
                    server={
                      activeServerId === ALL_SERVERS_ID && servers.length > 1
                        ? servers.find((entry) => entry.id === item.thread.serverId)
                        : undefined
                    }
                    selected={false}
                    onPressIn={() => onPreloadThread(threadSelectionKey(item.thread))}
                    onPress={() => onSelectThread(threadSelectionKey(item.thread))}
                    onTogglePin={() => onTogglePin(item.thread)}
                    onArchive={() => onArchive(item.thread)}
                    onUnarchive={() => onUnarchive(item.thread)}
                    onMarkRead={() => onMarkRead(item.thread)}
                  />
                )
              }
            />
          ))}
      </View>
      {searchContent === null && mode === "active" && (
        <NewThreadFloatingButton projectName={project?.name ?? null} onPress={onNewThread} />
      )}
    </View>
  );
}
