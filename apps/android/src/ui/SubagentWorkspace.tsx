import { Ionicons } from "@expo/vector-icons";
import { LegendList } from "@legendapp/list/react-native";
import { type ReactNode, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";

import { formatDeviceTime } from "../data/device-time";
import {
  subagentDisplayName,
  subagentIsActive,
} from "../data/subagent-projection";
import { plainThreadPreview } from "../data/thread-cache";
import type { StoredThreadSummary } from "../data/thread-summary-types";
import {
  colors,
  iconSize,
  layoutSize,
  radii,
  spacing,
  touchTarget,
  typeScale,
  typeWeight,
} from "../theme";
import { threadListLayout } from "./thread-list-layout";
import { AppText as Text } from "./Typography";
import { WaveText } from "./WaveText";

const MASTER_DETAIL_BREAKPOINT = 720;
const MASTER_MIN_WIDTH = 280;
const MASTER_MAX_WIDTH = 360;
const SUBAGENT_ROW_HEIGHT =
  threadListLayout.rowContentHeight + threadListLayout.rowVerticalMargin * 2;

export function SubagentWorkspace({
  subagents,
  selected,
  onSelect,
  onBack,
  onClose,
  renderDetail,
}: {
  subagents: readonly StoredThreadSummary[];
  selected: StoredThreadSummary | null;
  onSelect(summary: StoredThreadSummary): void;
  onBack(): void;
  onClose(): void;
  renderDetail(compact: boolean): ReactNode;
}) {
  const window = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const width = measuredWidth > 0 ? measuredWidth : window.width;
  const compact = width < MASTER_DETAIL_BREAKPOINT;
  const showMaster = !compact || selected === null;
  const showDetail = !compact || selected !== null;
  const masterWidth = compact
    ? width
    : Math.min(MASTER_MAX_WIDTH, Math.max(MASTER_MIN_WIDTH, Math.floor(width * 0.32)));

  return (
    <View
      testID="subagent-workspace"
      style={styles.workspace}
      onLayout={({ nativeEvent }) => {
        const next = Math.floor(nativeEvent.layout.width);
        setMeasuredWidth((current) => current === next ? current : next);
      }}
    >
      {showMaster && (
        <View testID="subagent-master-pane" style={[styles.master, { width: masterWidth }]}>
          <View style={styles.masterHeader}>
            <Pressable accessibilityLabel="Back to conversation" onPress={onClose} style={styles.iconButton}>
              <Ionicons name="arrow-back" size={iconSize.navigation} color={colors.text} />
            </Pressable>
            <Text numberOfLines={1} style={[styles.headerTitle, styles.masterTitle]}>Subagents</Text>
            <Text
              accessibilityLabel={`${subagents.length} ${subagents.length === 1 ? "subagent" : "subagents"}`}
              style={styles.headerCount}
            >
              {subagents.length}
            </Text>
          </View>
          <LegendList
            data={subagents}
            extraData={selected?.remoteThreadId ?? null}
            recycleItems
            estimatedItemSize={SUBAGENT_ROW_HEIGHT}
            getFixedItemSize={() => SUBAGENT_ROW_HEIGHT}
            drawDistance={360}
            keyExtractor={(summary) => summary.remoteThreadId}
            itemsAreEqual={subagentRowsEqual}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={<EmptySubagents />}
            renderItem={({ item }) => (
              <SubagentRow
                summary={item}
                selected={item.remoteThreadId === selected?.remoteThreadId}
                onPress={() => onSelect(item)}
              />
            )}
          />
        </View>
      )}
      {showDetail && (
        <View
          testID="subagent-detail-pane"
          style={[styles.detail, !compact && styles.detailRaised]}
        >
          {selected === null
            ? <EmptySelection />
            : renderDetail(compact)}
        </View>
      )}
    </View>
  );
}

function SubagentRow({ summary, selected, onPress }: { summary: StoredThreadSummary; selected: boolean; onPress(): void }) {
  const active = subagentIsActive(summary);
  const title = subagentDisplayName(summary);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open subagent ${title}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && styles.pressed]}
    >
      <View style={styles.rowText}>
        <View style={styles.rowTitleLine}>
          {active
            ? <WaveText testID={`subagent-active-${summary.remoteThreadId}`} text={title} style={styles.rowTitle} containerStyle={styles.rowTitleWave} />
            : <Text numberOfLines={1} style={styles.rowTitle}>{title}</Text>}
          {summary.status.type === "systemError" && (
            <View accessibilityLabel="Subagent failed" style={styles.statusIcon}>
              <Ionicons name="alert-circle" size={iconSize.inline} color={colors.red} />
            </View>
          )}
          <View style={styles.rowMeta}>
            {summary.unread > 0 && (
              <View style={styles.unreadSlot}>
                <View
                  accessibilityLabel={`${summary.unread} unread ${summary.unread === 1 ? "message" : "messages"}`}
                  style={styles.unreadDot}
                />
              </View>
            )}
            <Text numberOfLines={1} style={styles.time}>
              {formatDeviceTime(summary.recencyAt ?? summary.updatedAt)}
            </Text>
          </View>
        </View>
        <Text numberOfLines={1} ellipsizeMode="tail" style={styles.preview}>
          {subagentPreview(summary)}
        </Text>
      </View>
    </Pressable>
  );
}

export function SubagentPendingDetail({
  summary,
  compact,
  loading,
  error,
  onBack,
  onClose,
}: {
  summary: StoredThreadSummary;
  compact: boolean;
  loading: boolean;
  error: string | null;
  onBack(): void;
  onClose(): void;
}) {
  return (
    <View style={styles.pendingPane}>
      <View style={styles.detailHeader}>
        {compact && (
          <Pressable accessibilityLabel="Back to subagents" onPress={onBack} style={styles.iconButton}>
            <Ionicons name="arrow-back" size={iconSize.navigation} color={colors.text} />
          </Pressable>
        )}
        <View style={styles.headerIdentity}>
          <Text numberOfLines={1} style={styles.headerTitle}>{subagentDisplayName(summary)}</Text>
          <Text numberOfLines={1} style={styles.headerSubtitle}>{subagentSubtitle(summary)}</Text>
        </View>
        {!compact && (
          <Pressable accessibilityLabel="Close subagents" onPress={onClose} style={styles.iconButton}>
            <Ionicons name="close" size={iconSize.navigation} color={colors.text} />
          </Pressable>
        )}
      </View>
      {error !== null
        ? <Text selectable style={styles.error}>{error}</Text>
        : loading
          ? <View style={styles.center}><ActivityIndicator color={colors.accent} /><Text style={styles.muted}>Loading subchat…</Text></View>
          : <View style={styles.center}><Text style={styles.muted}>No messages yet</Text></View>}
    </View>
  );
}

function EmptySelection() {
  return (
    <View style={styles.center}>
      <Ionicons name="chatbubbles-outline" size={iconSize.illustration} color={colors.textDim} />
      <Text style={styles.muted}>Select a subagent</Text>
    </View>
  );
}

function EmptySubagents() {
  return (
    <View style={styles.empty}>
      <Ionicons name="people-outline" size={iconSize.illustration} color={colors.textDim} />
      <Text style={styles.muted}>No subagents in this thread</Text>
    </View>
  );
}

function subagentSubtitle(summary: StoredThreadSummary): string {
  if (summary.status.type === "notLoaded") return summary.agentRole || "Subagent";
  const state = summary.status.type === "active"
    ? "running"
    : summary.status.type === "systemError"
      ? "failed"
      : "idle";
  return summary.agentRole ? `${summary.agentRole} · ${state}` : state;
}

function subagentPreview(summary: StoredThreadSummary): string {
  const preview = plainThreadPreview(summary.preview);
  return preview === "" ? subagentSubtitle(summary) : preview;
}

function subagentRowsEqual(left: StoredThreadSummary, right: StoredThreadSummary): boolean {
  return left === right || (
    left.remoteThreadId === right.remoteThreadId
    && left.name === right.name
    && left.agentNickname === right.agentNickname
    && left.agentRole === right.agentRole
    && left.preview === right.preview
    && left.status.type === right.status.type
    && left.updatedAt === right.updatedAt
    && left.recencyAt === right.recencyAt
    && left.unread === right.unread
  );
}

const styles = StyleSheet.create({
  workspace: { flex: 1, minWidth: 0, minHeight: 0, flexDirection: "row", backgroundColor: colors.threadListSurface },
  master: { minWidth: 0, minHeight: 0, backgroundColor: colors.threadListSurface },
  detail: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: colors.conversationSurface },
  detailRaised: { borderTopLeftRadius: radii.composer, borderBottomLeftRadius: radii.composer, overflow: "hidden" },
  masterHeader: {
    minHeight: layoutSize.header,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
    paddingLeft: threadListLayout.edgeInset,
    paddingRight: spacing.md,
  },
  detailHeader: { minHeight: layoutSize.header, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.xs },
  headerIdentity: { flex: 1, minWidth: 0 },
  headerTitle: { color: colors.text, ...typeScale.title },
  masterTitle: { flex: 1, minWidth: 0 },
  headerCount: { flexShrink: 0, color: colors.textMuted, ...typeScale.label },
  headerSubtitle: { color: colors.textMuted, ...typeScale.label },
  iconButton: { width: touchTarget, height: touchTarget, borderRadius: radii.large, alignItems: "center", justifyContent: "center" },
  listContent: { paddingBottom: spacing.md },
  row: {
    height: threadListLayout.rowContentHeight,
    marginHorizontal: threadListLayout.edgeInset,
    marginVertical: threadListLayout.rowVerticalMargin,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.compact,
    borderRadius: radii.selected,
    flexDirection: "row",
    alignItems: "center",
  },
  rowSelected: { backgroundColor: colors.secondaryContainer },
  pressed: { opacity: 0.68 },
  rowText: { flex: 1, minWidth: 0, gap: spacing.optical },
  rowTitleLine: { width: "100%", minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  rowTitle: { minWidth: 0, flexShrink: 1, color: colors.text, ...typeScale.body, fontWeight: typeWeight.semibold },
  rowTitleWave: { flex: 1 },
  statusIcon: { width: 18, height: 18, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  rowMeta: { flexShrink: 0, flexDirection: "row", alignItems: "center", gap: spacing.xxs },
  unreadSlot: { width: 7, height: 18, flexShrink: 0, alignItems: "center", justifyContent: "center" },
  unreadDot: { width: 7, height: 7, borderRadius: radii.pill, backgroundColor: colors.primary },
  time: { flexShrink: 0, color: colors.textMuted, ...typeScale.caption, textAlign: "right", fontVariant: ["tabular-nums"] },
  preview: { minWidth: 0, maxWidth: "100%", flexShrink: 1, color: colors.textMuted, ...typeScale.label },
  pendingPane: { flex: 1, minHeight: 0 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  empty: { minHeight: 180, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  muted: { color: colors.textMuted, ...typeScale.body },
  error: { color: colors.red, padding: spacing.sm, ...typeScale.body },
});
