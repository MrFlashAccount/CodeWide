import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  type PressableStateCallbackType,
  SectionList,
  type SectionListData,
  type SectionListRenderItemInfo,
  StyleSheet,
  View,
} from "react-native";

import { colors, radii, spacing } from "../../theme";
import { ActionMenu, type ActionMenuItem } from "../../ui/ActionMenu";
import { PresentationIcon } from "../icons/PresentationIcon";
import {
  PresentationText as Text,
  PresentationTextInput as TextInput,
  ProductText,
} from "../text/ProductText";
import { useEvent } from "../../react/useEvent";

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

interface ThreadListSection {
  data: RenderableThreadListRow[];
  title: string;
}

interface ThreadSectionHeaderInfo {
  section: SectionListData<RenderableThreadListRow, ThreadListSection>;
}

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
  const pinnedRows = renderableRows.filter((row) => row.pinned === true);
  const recentRows = renderableRows.filter((row) => row.pinned !== true);
  const sections: ThreadListSection[] = showSections
    ? [
        ...(pinnedRows.length === 0 ? [] : [{ data: pinnedRows, title: "Pinned" }]),
        ...(recentRows.length === 0 ? [] : [{ data: recentRows, title: "Recent" }]),
      ]
    : [{ data: renderableRows, title: "" }];

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
                  <ActivityIndicator color={colors.accent} size="small" />
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
      <SectionList<RenderableThreadListRow, ThreadListSection>
        contentContainerStyle={visibleRows.length === 0 ? styles.emptyList : styles.list}
        sections={sections}
        keyExtractor={threadKey}
        ListEmptyComponent={
          <View style={styles.empty}>
            <PresentationIcon color={colors.textDim} name="chat" size={24} />
            <ProductText tone="muted">No threads found</ProductText>
          </View>
        }
        renderItem={renderThread}
        renderSectionHeader={renderSectionHeader}
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

function renderThread(
  row2: SectionListRenderItemInfo<RenderableThreadListRow, ThreadListSection>,
): React.JSX.Element {
  const { item } = row2;
  return <ThreadRow onOpen={item.onOpen} row={item} selected={item.selected} />;
}

function renderSectionHeader(value: ThreadSectionHeaderInfo): React.JSX.Element | null {
  const { section } = value;
  if (section.title === "") return null;
  return (
    <ProductText style={styles.section} tone="muted" weight="semibold">
      {section.title}
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
          {active || attention ? (
            <PresentationIcon
              color={active ? colors.amber : colors.red}
              name={active ? "flash" : "alert"}
              size={14}
            />
          ) : null}
          <View style={styles.titleSlot}>
            <ProductText numberOfLines={1} style={styles.title} weight="semibold">
              {row.title}
            </ProductText>
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
  disabled: { opacity: 0.45 },
  empty: { alignItems: "center", gap: spacing.xs },
  emptyList: { flexGrow: 1, justifyContent: "center", paddingHorizontal: spacing.lg },
  emoji: { flexShrink: 0, fontSize: 17, lineHeight: 20 },
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
    fontSize: 14,
    lineHeight: 20,
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
    color: colors.textMuted,
    flexShrink: 0,
    fontSize: 10,
    fontVariant: ["tabular-nums"],
    minWidth: 48,
    textAlign: "right",
  },
  threadMeta: { alignItems: "center", flexDirection: "row", flexShrink: 0, gap: 5 },
  title: { flexShrink: 1, fontSize: 14, lineHeight: 19, maxWidth: "100%", minWidth: 0 },
  titleRow: { alignItems: "center", flexDirection: "row", gap: spacing.xs, minWidth: 0 },
  titleSlot: { alignItems: "flex-start", flex: 1, minWidth: 0 },
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
  voiceSearchInput: { paddingRight: 44 },
});
