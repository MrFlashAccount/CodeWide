import { useState } from "react";
import { LegendList, type LegendListRenderItemProps } from "@legendapp/list/react-native";
import { Pressable, type PressableStateCallbackType, StyleSheet, View } from "react-native";

import { colors, radii, spacing, touchTarget, typeScale, typeTracking } from "../../theme";
import { ActionMenu, type ActionMenuItem } from "../../ui/ActionMenu";
import { PresentationIcon } from "../icons/PresentationIcon";
import {
  PresentationText as Text,
  PresentationTextInput as TextInput,
  ProductText,
} from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";
import { useEvent } from "../../../react/useEvent";

type ThreadListFilter = "all" | "approval" | "pinned" | "running" | "unread";

const FILTER_ITEMS: ActionMenuItem[] = [
  { id: "all", label: "All threads" },
  { id: "running", label: "Running" },
  { id: "approval", label: "Approval needed" },
  { id: "unread", label: "Unread" },
  { id: "pinned", label: "Pinned" },
];

export interface ThreadListRow {
  archived?: boolean;
  emoji?: string;
  id: string;
  pinned?: boolean;
  preview?: string;
  retained: boolean;
  state: string;
  title: string;
  unread?: number;
  updatedAt: string;
}

export interface ThreadListVoiceControl {
  activate(): Promise<void>;
  disabled: boolean;
  state: "error" | "finishing" | "idle" | "recording" | "retry" | "starting";
}

interface ThreadListViewProps {
  onChangeQuery?(query: string): void;
  onOpen(id: string): void;
  query?: string;
  rows: ThreadListRow[];
  selectedId?: string;
  showSections?: boolean;
  voice?: ThreadListVoiceControl;
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

interface ThreadListHeaderItem {
  kind: "header";
  title: string;
}

interface ThreadListThreadItem {
  kind: "thread";
  row: RenderableThreadListRow;
}

type RenderableThreadListItem = ThreadListHeaderItem | ThreadListThreadItem;

export function ThreadListView(props: ThreadListViewProps): React.JSX.Element {
  const { onChangeQuery, onOpen, query, rows, selectedId, showSections = true, voice } = props;
  const [localQuery, setLocalQuery] = useState("");
  const [filter, setFilter] = useState<ThreadListFilter>("all");
  const [voicePending, setVoicePending] = useState(false);
  const selectFilter = useEvent((id: string) => {
    if (isThreadListFilter(id)) setFilter(id);
  });
  const activateVoice = useEvent(() => {
    if (voice === undefined || voice.disabled || voicePending) return;
    setVoicePending(true);
    voice
      .activate()
      .catch(() => undefined)
      .finally(() => setVoicePending(false));
  });
  const effectiveQuery = query ?? localQuery;
  const changeQuery = useEvent((value: string) => {
    if (query === undefined) setLocalQuery(value);
    onChangeQuery?.(value);
  });
  const normalizedQuery = effectiveQuery.trim().toLocaleLowerCase();
  const visibleRows = rows.filter(
    (row) =>
      threadMatchesFilter(row, filter) &&
      (normalizedQuery === "" ||
        `${row.title} ${row.preview ?? ""} ${row.id}`
          .toLocaleLowerCase()
          .includes(normalizedQuery)),
  );
  const renderableRows = visibleRows.map((row) => ({
    ...row,
    onOpen,
    selected: row.id === selectedId,
  }));
  const listItems = buildThreadListItems(renderableRows, showSections);

  return (
    <View style={styles.root}>
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <PresentationIcon color={colors.textMuted} name="search" size={18} />
          <View style={styles.searchInputSlot}>
            <TextInput
              accessibilityLabel="Search threads"
              onChangeText={changeQuery}
              placeholder="Search threads"
              placeholderTextColor={colors.textDim}
              style={[
                styles.searchInput,
                voice === undefined ? undefined : styles.voiceSearchInput,
              ]}
              value={effectiveQuery}
            />
            {voice === undefined ? null : (
              <Pressable
                accessibilityLabel={
                  voice.state === "retry"
                    ? "Retry voice input"
                    : voice.state === "idle" || voice.state === "error"
                      ? "Voice input"
                      : "Stop voice input"
                }
                accessibilityRole="button"
                accessibilityState={{ busy: voicePending, disabled: voice.disabled }}
                disabled={voice.disabled}
                onPress={activateVoice}
                style={[styles.voiceButton, voice.disabled && styles.disabled]}
              >
                {voicePending || voice.state === "starting" || voice.state === "finishing" ? (
                  <ShimmerText style={styles.voiceProgress} text="Voice" />
                ) : (
                  <PresentationIcon
                    color={voice.state === "recording" ? colors.red : colors.textMuted}
                    name={
                      voice.state === "retry" || voice.state === "error"
                        ? "refresh"
                        : voice.state === "recording"
                          ? "stop"
                          : "mic"
                    }
                    size={19}
                  />
                )}
              </Pressable>
            )}
          </View>
        </View>
        <ActionMenu
          accessibilityLabel="Thread filters"
          actions={FILTER_ITEMS.map((item) => ({ ...item, selected: item.id === filter }))}
          align="end"
          menuWidth={220}
          onSelect={selectFilter}
          placement="bottom"
        >
          <Pressable
            accessibilityLabel="Thread filters"
            accessibilityRole="button"
            accessibilityState={{ selected: filter !== "all" }}
            style={filterButtonStyle}
          >
            <PresentationIcon color={colors.text} name="filter" size={20} />
          </Pressable>
        </ActionMenu>
      </View>
      <LegendList
        contentContainerStyle={visibleRows.length === 0 ? styles.emptyList : styles.list}
        data={listItems}
        dataKey={showSections ? "thread-list:sectioned" : "thread-list:flat"}
        drawDistance={320}
        estimatedItemSize={64}
        extraData={selectedId}
        getItemType={threadListItemType}
        itemsAreEqual={threadListItemsEqual}
        keyExtractor={threadListKey}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={styles.empty}>
            <PresentationIcon color={colors.textDim} name="chat" size={24} />
            <ProductText tone="muted">No threads found</ProductText>
          </View>
        }
        recycleItems
        renderItem={renderThreadListItem}
      />
    </View>
  );
}

function isThreadListFilter(value: string): value is ThreadListFilter {
  return (
    value === "all" ||
    value === "approval" ||
    value === "pinned" ||
    value === "running" ||
    value === "unread"
  );
}

function threadMatchesFilter(row: ThreadListRow, filter: ThreadListFilter): boolean {
  if (filter === "running") return row.state === "running";
  if (filter === "approval")
    return row.state === "waitingForApproval" || row.state === "waitingForInput";
  if (filter === "unread") return (row.unread ?? 0) > 0;
  if (filter === "pinned") return row.pinned === true;
  return true;
}

function buildThreadListItems(
  rows: RenderableThreadListRow[],
  showSections: boolean,
): RenderableThreadListItem[] {
  const items: RenderableThreadListItem[] = [];
  if (!showSections) {
    for (const row of rows) items.push({ kind: "thread", row });
    return items;
  }

  const pinnedRows = rows.filter((row) => row.pinned === true);
  const recentRows = rows.filter((row) => row.pinned !== true);
  appendThreadListSection(items, "Pinned", pinnedRows);
  appendThreadListSection(items, "Recent", recentRows);
  return items;
}

function appendThreadListSection(
  items: RenderableThreadListItem[],
  title: string,
  rows: RenderableThreadListRow[],
): void {
  if (rows.length === 0) return;
  items.push({ kind: "header", title });
  for (const row of rows) items.push({ kind: "thread", row });
}

function renderThreadListItem(
  value: LegendListRenderItemProps<RenderableThreadListItem>,
): React.JSX.Element {
  const { item } = value;
  if (item.kind === "thread") {
    return <ThreadRow onOpen={item.row.onOpen} row={item.row} selected={item.row.selected} />;
  }
  return (
    <ProductText style={styles.section} tone="muted" weight="semibold">
      {item.title}
    </ProductText>
  );
}

function ThreadRow(props: ThreadRowProps): React.JSX.Element {
  const { onOpen, row, selected } = props;
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
          {row.emoji === undefined ? null : (
            <ProductText style={styles.emoji}>{row.emoji}</ProductText>
          )}
          {attention ? <PresentationIcon color={colors.red} name="alert" size={14} /> : null}
          <View style={styles.titleSlot}>
            {active ? (
              <ShimmerText
                containerStyle={styles.titleShimmer}
                style={styles.title}
                text={row.title}
              />
            ) : (
              <ProductText numberOfLines={1} style={styles.title} weight="semibold">
                {row.title}
              </ProductText>
            )}
          </View>
          <View style={styles.threadMeta}>
            <View style={styles.unreadSlot}>
              {(row.unread ?? 0) > 0 ? <View style={styles.unreadDot} /> : null}
            </View>
            <Text numberOfLines={1} style={styles.time}>
              {row.updatedAt}
            </Text>
          </View>
        </View>
        <View style={styles.previewRow}>
          <ProductText numberOfLines={1} style={styles.preview} tone="muted">
            {row.preview ?? threadStateLabel(row.state, row.retained)}
          </ProductText>
        </View>
      </View>
    </Pressable>
  );
}

function selectedThreadStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.thread, styles.threadSelected, pressed && styles.pressed];
}

function unselectedThreadStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.thread, pressed && styles.pressed];
}

function filterButtonStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.filterButton, pressed && styles.pressed];
}

function threadListKey(item: RenderableThreadListItem): string {
  return item.kind === "header" ? `header:${item.title}` : item.row.id;
}

function threadListItemType(item: RenderableThreadListItem): RenderableThreadListItem["kind"] {
  return item.kind;
}

function threadListItemsEqual(
  left: RenderableThreadListItem,
  right: RenderableThreadListItem,
): boolean {
  if (left === right) return true;
  if (left.kind === "header") return right.kind === "header" && left.title === right.title;
  if (right.kind === "header") return false;
  return threadRowsEqual(left.row, right.row);
}

function threadRowsEqual(left: RenderableThreadListRow, right: RenderableThreadListRow): boolean {
  return (
    left.id === right.id &&
    left.archived === right.archived &&
    left.emoji === right.emoji &&
    left.onOpen === right.onOpen &&
    left.pinned === right.pinned &&
    left.preview === right.preview &&
    left.retained === right.retained &&
    left.selected === right.selected &&
    left.state === right.state &&
    left.title === right.title &&
    left.unread === right.unread &&
    left.updatedAt === right.updatedAt
  );
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
  disabled: { opacity: 0.45 },
  empty: { alignItems: "center", gap: spacing.xs },
  emptyList: { flexGrow: 1, justifyContent: "center", paddingHorizontal: spacing.lg },
  emoji: { flexShrink: 0, ...typeScale.title },
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
  preview: { flex: 1, ...typeScale.label },
  previewRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    maxWidth: "100%",
    minWidth: 0,
    width: "100%",
  },
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
    ...typeScale.body,

    minWidth: 0,
    paddingVertical: 0,
    width: "100%",
  },
  searchInputSlot: { alignSelf: "stretch", flex: 1, minHeight: 40, minWidth: 0 },
  searchRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xxs,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
  },
  section: {
    ...typeScale.caption,
    letterSpacing: typeTracking.caps,

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
    marginVertical: spacing.optical,
    minHeight: 64,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  threadCopy: { flex: 1, gap: spacing.optical, minWidth: 0 },
  threadSelected: { backgroundColor: colors.secondaryContainer },
  time: {
    color: colors.textMuted,
    flexShrink: 0,
    ...typeScale.caption,
    fontVariant: ["tabular-nums"],
    minWidth: 48,
    textAlign: "right",
  },
  threadMeta: { alignItems: "center", flexDirection: "row", flexShrink: 0, gap: spacing.xs },
  title: { flexShrink: 1, ...typeScale.body, maxWidth: "100%", minWidth: 0 },
  titleRow: { alignItems: "center", flexDirection: "row", gap: spacing.xs, minWidth: 0 },
  titleSlot: { alignItems: "flex-start", flex: 1, minWidth: 0 },
  titleShimmer: { alignSelf: "stretch" },
  unreadDot: { backgroundColor: colors.accent, borderRadius: 4, height: 7, width: 7 },
  unreadSlot: {
    alignItems: "center",
    flexShrink: 0,
    height: 18,
    justifyContent: "center",
    width: 7,
  },
  voiceButton: {
    alignItems: "center",
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    position: "absolute",
    right: 2,
    top: 2,
    width: 40,
  },
  voiceSearchInput: { paddingRight: touchTarget - spacing.xxs },
  voiceProgress: { color: colors.accent, ...typeScale.caption },
});
