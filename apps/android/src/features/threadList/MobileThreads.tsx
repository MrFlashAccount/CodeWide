import type { MobileThreadsProps } from "./MobileThreadsContract";
import { MobileThreadsHeader } from "./MobileThreadsHeader";
import { LegendList } from "@legendapp/list/react-native";
import { View } from "react-native";
import { usePerformanceExperiment } from "../../data/performance-experiments";
import { threadSelectionKey } from "../../services/threads/threadRouteParams";
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
    onPreloadThread,
    onSelectThread,
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

  return (
    <View style={styles.mobileList}>
      <MobileThreadsHeader archivedCount={filteredArchived.length} props={props} />
      <View style={styles.threadListContentSurface}>
        {searchContent ??
          (hideThreadLists ? (
            <View style={styles.threadListSuspended}>
              <ThreadListExperimentSuspended />
            </View>
          ) : (
            <LegendList
              data={mobileRows}
              dataKey={`mobile-threads:${serverScope.kind === "all" ? "all" : serverScope.connectionId}:${mode}:${project?.key ?? "global"}`}
              drawDistance={320}
              getFixedItemSize={threadListRowHeight}
              getItemType={(item) => item.kind}
              initialScrollOffset={initialOffset}
              itemsAreEqual={threadListRowsEqual}
              key={`${serverScope.kind === "all" ? "all" : serverScope.connectionId}:${mode}:${project?.key ?? "global"}`}
              keyExtractor={sidebarRowKey}
              ListEmptyComponent={
                <SidebarListFeedback
                  archived={mode === "archived"}
                  key={`${serverScope.kind === "all" ? "all" : serverScope.connectionId}:${mode}:${query}:${project?.key ?? "global"}`}
                  state={project === null ? catalogState : projectSource.state}
                />
              }
              ListFooterComponent={
                mobileRows.length > 0 && mode === "active" && filteredThreads.length === 0 ? (
                  <SidebarListFeedback
                    archived={false}
                    key={`${serverScope.kind === "all" ? "all" : serverScope.connectionId}:${mode}:${query}:${project?.key ?? "global"}`}
                    state={project === null ? catalogState : projectSource.state}
                  />
                ) : null
              }
              onEndReached={project === null ? onLoadMore : projectSource.loadMore}
              onEndReachedThreshold={0.4}
              onScroll={({ nativeEvent }) => {
                onOffsetChange(nativeEvent.contentOffset.y);
              }}
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
                    onArchive={async () => onArchive(item.thread)}
                    onMarkRead={async () => onMarkRead(item.thread)}
                    onPress={() => {
                      onSelectThread(threadSelectionKey(item.thread));
                    }}
                    onPressIn={() => onPreloadThread(threadSelectionKey(item.thread))}
                    onTogglePin={async () => onTogglePin(item.thread)}
                    onUnarchive={async () => onUnarchive(item.thread)}
                    selected={false}
                    server={
                      serverScope.kind === "all" && servers.length > 1
                        ? servers.find((entry) => entry.id === item.thread.serverId)
                        : undefined
                    }
                    thread={item.thread}
                  />
                )
              }
              scrollEventThrottle={100}
            />
          ))}
      </View>
      {searchContent === null && mode === "active" && (
        <NewThreadFloatingButton onPress={onNewThread} projectName={project?.name ?? null} />
      )}
    </View>
  );
}
