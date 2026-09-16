import type { ThreadSidebarProps } from "./ThreadSidebarContract";
import { ThreadSidebarHeader } from "./ThreadSidebarHeader";
import { LegendList } from "@legendapp/list/react-native";
import { useState } from "react";
import { View } from "react-native";
import { usePerformanceExperiment } from "../../data/performance-experiments";
import { threadSelectionKey } from "../../services/threads/threadRouteParams";
import { NewThreadFloatingButton } from "../projects/NewThreadFloatingButton";
import { SidebarProjectRow } from "../projects/SidebarProjects";
import { SelectableThreadRow } from "./SelectableThreadRow";
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
import { styles } from "./ThreadSidebar.styles";

export function ThreadSidebar(props: ThreadSidebarProps) {
  const {
    catalogState,
    remote,
    project,
    projects,
    onOpenProject,
    projectLimit,
    onLoadMoreProject,
    initialOffset,
    onOffsetChange,
    width,
    servers,
    serverScope,
    threads,
    archivedThreads,
    mode,
    filter,
    selectedThreadKey,
    searchContent,
    onLoadMore,
    onSelect,
    onPreload,
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
  const [query, setQuery] = useState("");
  const filtered = (project === null ? threads : projectSource.threads).filter(
    (thread) =>
      threadMatchesFilter(thread, filter) &&
      `${thread.title} ${thread.preview}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
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

  return (
    <View testID="thread-list-pane" style={[styles.threadSidebar, { width }]}>
      <ThreadSidebarHeader props={props} setQuery={setQuery} />
      <View style={styles.threadListContentSurface}>
        {searchContent ??
          (hideThreadLists ? (
            <View style={styles.threadListSuspended}>
              <ThreadListExperimentSuspended />
            </View>
          ) : (
            <LegendList
              data={rows}
              key={`${serverScope.kind === "all" ? "all" : serverScope.connectionId}:${mode}:${project?.key ?? "global"}`}
              dataKey={`desktop-threads:${serverScope.kind === "all" ? "all" : serverScope.connectionId}:${mode}:${project?.key ?? "global"}`}
              initialScrollOffset={initialOffset}
              onScroll={({ nativeEvent }) => onOffsetChange(nativeEvent.contentOffset.y)}
              scrollEventThrottle={100}
              getFixedItemSize={threadListRowHeight}
              drawDistance={320}
              recycleItems
              getItemType={(row) => row.kind}
              itemsAreEqual={threadListRowsEqual}
              keyExtractor={sidebarRowKey}
              keyboardShouldPersistTaps="handled"
              onEndReached={project === null ? onLoadMore : projectSource.loadMore}
              onEndReachedThreshold={0.4}
              ListEmptyComponent={
                <SidebarListFeedback
                  key={`${serverScope.kind === "all" ? "all" : serverScope.connectionId}:${mode}:${query}:${project?.key ?? "global"}`}
                  state={project === null ? catalogState : projectSource.state}
                  archived={mode === "archived"}
                />
              }
              ListFooterComponent={
                rows.length > 0 && mode === "active" && filtered.length === 0 ? (
                  <SidebarListFeedback
                    key={`${serverScope.kind === "all" ? "all" : serverScope.connectionId}:${mode}:${query}:${project?.key ?? "global"}`}
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
                    onPress={() => {
                      setQuery("");
                      onOpenProject(item.project);
                    }}
                  />
                ) : (
                  <SelectableThreadRow
                    selectedThreadKey={selectedThreadKey}
                    thread={item.thread}
                    server={
                      serverScope.kind === "all" && servers.length > 1
                        ? servers.find((entry) => entry.id === item.thread.serverId)
                        : undefined
                    }
                    onPressIn={() => onPreload(threadSelectionKey(item.thread))}
                    onPress={() => onSelect(threadSelectionKey(item.thread))}
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
