import { LegendList, type LegendListRenderItemProps } from "@legendapp/list/react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, spacing, typeScale, typeTracking } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";
import { ThreadListFooter } from "./ThreadListFooter";
import {
  buildThreadListItems,
  threadListItemKey,
  threadListItemsEqual,
  threadListItemType,
  type RenderableThreadListItem,
} from "./threadListItems";
import { isThreadListFilter, threadMatchesFilter, threadMatchesQuery } from "./threadListModel";
import { ThreadListRowView } from "./ThreadListRowView";
import { ThreadListToolbar } from "./ThreadListToolbar";
import type {
  ThreadListFilter,
  ThreadListPagingControl,
  ThreadListRow,
  ThreadListRowActions,
  ThreadListVoiceControl,
} from "./threadListTypes";

export type {
  ThreadListPagingControl,
  ThreadListRow,
  ThreadListRowActions,
  ThreadListVoiceControl,
} from "./threadListTypes";

interface ThreadListViewProps {
  actions?: ThreadListRowActions;
  onActionError?(message: string): void;
  onChangeQuery?(query: string): void;
  onOpen(id: string): void;
  onPrewarm?(id: string): void;
  paging?: ThreadListPagingControl;
  query?: string;
  rows: ThreadListRow[];
  selectedId?: string;
  showSections?: boolean;
  voice?: ThreadListVoiceControl;
}

export function ThreadListView(props: ThreadListViewProps): React.JSX.Element {
  const {
    actions,
    onActionError,
    onChangeQuery,
    onOpen,
    onPrewarm,
    paging,
    query,
    rows,
    selectedId,
    showSections = true,
    voice,
  } = props;
  const [localQuery, setLocalQuery] = useState("");
  const [filter, setFilter] = useState<ThreadListFilter>("all");
  const selectFilter = useEvent((id: string) => {
    if (isThreadListFilter(id)) setFilter(id);
  });
  const effectiveQuery = query ?? localQuery;
  const changeQuery = useEvent((value: string) => {
    if (query === undefined) setLocalQuery(value);
    onChangeQuery?.(value);
  });
  const loadMore = useEvent(() => {
    if (paging === undefined || !paging.canLoadMore || paging.loading || paging.error !== null)
      return;
    paging.loadMore().catch(() => undefined);
  });
  const normalizedQuery = effectiveQuery.trim().toLocaleLowerCase();
  const visibleRows = rows.filter(
    (row) => threadMatchesFilter(row, filter) && threadMatchesQuery(row, normalizedQuery),
  );
  const listItems = buildThreadListItems({
    actions,
    onActionError,
    onOpen,
    onPrewarm,
    rows: visibleRows,
    selectedId,
    showSections,
  });
  const emptyState =
    paging !== undefined &&
    (paging.loading ||
      paging.error !== null ||
      (paging.canLoadMore && paging.loadingLabel !== undefined)) ? (
      <ThreadListFooter paging={paging} />
    ) : (
      <ThreadListEmpty />
    );

  return (
    <View style={styles.root}>
      <ThreadListToolbar
        filter={filter}
        onChangeQuery={changeQuery}
        onSelectFilter={selectFilter}
        query={effectiveQuery}
        {...(voice === undefined ? {} : { voice })}
      />
      <LegendList
        contentContainerStyle={visibleRows.length === 0 ? styles.emptyList : styles.list}
        data={listItems}
        dataKey={showSections ? "thread-list:sectioned" : "thread-list:flat"}
        drawDistance={320}
        estimatedItemSize={64}
        getItemType={threadListItemType}
        itemsAreEqual={threadListItemsEqual}
        keyExtractor={threadListItemKey}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={emptyState}
        ListFooterComponent={paging === undefined ? null : <ThreadListFooter paging={paging} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.45}
        recycleItems
        renderItem={renderThreadListItem}
      />
    </View>
  );
}

function ThreadListEmpty(): React.JSX.Element {
  return (
    <View style={styles.empty}>
      <PresentationIcon color={colors.textDim} name="chat" size={24} />
      <ProductText tone="muted">No threads found</ProductText>
    </View>
  );
}

function renderThreadListItem(
  value: LegendListRenderItemProps<RenderableThreadListItem>,
): React.JSX.Element {
  const { item } = value;
  if (item.kind === "thread") {
    return (
      <ThreadListRowView
        onOpen={item.onOpen}
        {...(item.onPrewarm === undefined ? {} : { onPrewarm: item.onPrewarm })}
        row={item.row}
        selected={item.selected}
        {...(item.actions === undefined ? {} : { actions: item.actions })}
        {...(item.onActionError === undefined ? {} : { onActionError: item.onActionError })}
      />
    );
  }
  return (
    <ProductText style={styles.section} tone="muted" weight="semibold">
      {item.title}
    </ProductText>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: "center", gap: spacing.xs },
  emptyList: { flexGrow: 1, justifyContent: "center", paddingHorizontal: spacing.lg },
  list: { paddingBottom: spacing.md },
  root: { backgroundColor: colors.surface, flex: 1, minHeight: 0 },
  section: {
    ...typeScale.caption,
    letterSpacing: typeTracking.caps,
    paddingBottom: spacing.xxs,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    textTransform: "uppercase",
  },
});
