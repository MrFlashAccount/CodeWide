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
    onPreload,
    onSelect,
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
    <View style={[styles.threadSidebar, { width }]} testID="thread-list-pane">
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
              dataKey={`desktop-threads:${serverScope.kind === "all" ? "all" : serverScope.connectionId}:${mode}:${project?.key ?? "global"}`}
              drawDistance={320}
              getFixedItemSize={threadListRowHeight}
              getItemType={(row) => row.kind}
              initialScrollOffset={initialOffset}
              itemsAreEqual={threadListRowsEqual}
              key={`${serverScope.kind === "all" ? "all" : serverScope.connectionId}:${mode}:${project?.key ?? "global"}`}
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
                rows.length > 0 && mode === "active" && filtered.length === 0 ? (
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
                      setQuery("");
                      onOpenProject(item.project);
                    }}
                    project={item.project}
                  />
                ) : (
                  <SelectableThreadRow
                    onArchive={async () => onArchive(item.thread)}
                    onMarkRead={async () => onMarkRead(item.thread)}
                    onPress={() => {
                      onSelect(threadSelectionKey(item.thread));
                    }}
                    onPressIn={() => onPreload(threadSelectionKey(item.thread))}
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
