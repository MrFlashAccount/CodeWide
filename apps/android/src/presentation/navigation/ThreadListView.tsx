import { useState } from "react";
import {
  FlatList,
  type ListRenderItemInfo,
  Pressable,
  type PressableStateCallbackType,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

import { colors, radii, spacing } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";
import { useEvent } from "../../react/useEvent";

export interface ThreadListRow {
  id: string;
  preview?: string;
  retained: boolean;
  state: string;
  title: string;
  updatedAt: string;
}

interface ThreadListViewProps {
  onOpen(id: string): void;
  rows: ThreadListRow[];
  selectedId?: string;
}

interface ThreadRowProps {
  onOpen(id: string): void;
  row: ThreadListRow;
  selected: boolean;
}

interface RenderableThreadListRow extends ThreadListRow {
  onOpen(id: string): void;
  selected: boolean;
}

export function ThreadListView({
  onOpen,
  rows,
  selectedId,
}: ThreadListViewProps): React.JSX.Element {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleRows =
    normalizedQuery === ""
      ? rows
      : rows.filter((row) =>
          `${row.title} ${row.preview ?? ""}`.toLocaleLowerCase().includes(normalizedQuery),
        );
  const renderableRows = visibleRows.map((row) => ({
    ...row,
    onOpen,
    selected: row.id === selectedId,
  }));

  return (
    <View style={styles.root}>
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <PresentationIcon color={colors.textMuted} name="search" size={18} />
          <TextInput
            accessibilityLabel="Search V2 threads"
            onChangeText={setQuery}
            placeholder="Search threads"
            placeholderTextColor={colors.textDim}
            style={styles.searchInput}
            value={query}
          />
        </View>
        <Pressable
          accessibilityLabel="Thread filters"
          accessibilityRole="button"
          style={filterButtonStyle}
        >
          <PresentationIcon color={colors.text} name="filter" size={20} />
        </Pressable>
      </View>
      <FlatList
        contentContainerStyle={visibleRows.length === 0 ? styles.emptyList : styles.list}
        data={renderableRows}
        keyExtractor={threadKey}
        ListEmptyComponent={
          <View style={styles.empty}>
            <PresentationIcon color={colors.textDim} name="chat" size={24} />
            <ProductText tone="muted">No threads found</ProductText>
          </View>
        }
        ListHeaderComponent={
          visibleRows.length === 0 ? null : (
            <ProductText style={styles.section} tone="muted" weight="semibold">
              Recent
            </ProductText>
          )
        }
        renderItem={renderThread}
      />
    </View>
  );
}

function renderThread({ item }: ListRenderItemInfo<RenderableThreadListRow>): React.JSX.Element {
  return <ThreadRow onOpen={item.onOpen} row={item} selected={item.selected} />;
}

function ThreadRow({ onOpen, row, selected }: ThreadRowProps): React.JSX.Element {
  const active = row.state === "running";
  const attention = row.state === "waitingForApproval" || row.state === "waitingForInput";
  const open = useEvent(() => onOpen(row.id));
  return (
    <Pressable
      accessibilityLabel={`Open thread ${row.title} ${row.id}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={open}
      style={selected ? selectedThreadStyle : unselectedThreadStyle}
    >
      <View style={styles.threadCopy}>
        <View style={styles.titleRow}>
          {active || attention ? (
            <PresentationIcon
              color={active ? colors.amber : colors.red}
              name={active ? "flash" : "alert"}
              size={14}
            />
          ) : null}
          <ProductText numberOfLines={1} style={styles.title} weight="semibold">
            {row.title}
          </ProductText>
          <ProductText style={styles.time} tone="muted">
            {row.updatedAt}
          </ProductText>
        </View>
        <ProductText numberOfLines={1} style={styles.preview} tone="muted">
          {row.preview ?? threadStateLabel(row.state, row.retained)}
        </ProductText>
      </View>
    </Pressable>
  );
}

function selectedThreadStyle({ pressed }: PressableStateCallbackType) {
  return [styles.thread, styles.threadSelected, pressed && styles.pressed];
}

function unselectedThreadStyle({ pressed }: PressableStateCallbackType) {
  return [styles.thread, pressed && styles.pressed];
}

function filterButtonStyle({ pressed }: PressableStateCallbackType) {
  return [styles.filterButton, pressed && styles.pressed];
}

function threadKey(row: ThreadListRow): string {
  return row.id;
}

function threadStateLabel(state: string, retained: boolean): string {
  const source = retained ? "Cached" : "Live";
  if (state === "running") return `${source} · Running`;
  if (state === "waitingForApproval") return `${source} · Approval needed`;
  if (state === "waitingForInput") return `${source} · Waiting for input`;
  if (state === "failed") return `${source} · Failed`;
  return source;
}

const styles = StyleSheet.create({
  empty: { alignItems: "center", gap: spacing.xs },
  emptyList: { flexGrow: 1, justifyContent: "center", paddingHorizontal: spacing.lg },
  filterButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.large,
    height: 44,
    justifyContent: "center",
    width: 40,
  },
  list: { paddingBottom: spacing.md },
  pressed: { opacity: 0.68 },
  preview: { flex: 1, fontSize: 12, lineHeight: 16 },
  root: { backgroundColor: colors.surface, flex: 1, minHeight: 0 },
  searchBox: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.large,
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
    height: 44,
    minWidth: 0,
    paddingHorizontal: spacing.sm,
  },
  searchInput: {
    color: colors.text,
    flex: 1,
    fontFamily: "RobotoFlex-Regular",
    fontSize: 14,
    lineHeight: 20,
    paddingVertical: 0,
  },
  searchRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xxs,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
  },
  section: {
    fontSize: 10,
    letterSpacing: 0.7,
    lineHeight: 14,
    paddingBottom: spacing.xxs,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    textTransform: "uppercase",
  },
  thread: {
    alignItems: "center",
    alignSelf: "stretch",
    borderRadius: radii.selected,
    flexDirection: "row",
    gap: spacing.xs,
    marginHorizontal: spacing.xs,
    marginVertical: 1,
    minHeight: 64,
    paddingHorizontal: spacing.xs,
    paddingVertical: 6,
  },
  threadCopy: { flex: 1, gap: 1, minWidth: 0 },
  threadSelected: { backgroundColor: colors.secondaryContainer },
  time: {
    flexShrink: 0,
    fontSize: 10,
    fontVariant: ["tabular-nums"],
    minWidth: 48,
    textAlign: "right",
  },
  title: { flex: 1, fontSize: 14, lineHeight: 19, minWidth: 0 },
  titleRow: { alignItems: "center", flexDirection: "row", gap: spacing.xs, minWidth: 0 },
});
