import { Ionicons } from "@expo/vector-icons";
import { LegendList } from "@legendapp/list/react-native";
import { type ReactNode, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";

import {
  subagentDisplayName,
  subagentIsActive,
} from "../data/subagent-projection";
import type { StoredThreadSummary } from "../data/thread-summary-types";
import { colors, radii, spacing, typeScale } from "../theme";
import { AppText as Text } from "./Typography";
import { WaveText } from "./WaveText";

const MASTER_DETAIL_BREAKPOINT = 720;
const MASTER_MIN_WIDTH = 280;
const MASTER_MAX_WIDTH = 360;

export function SubagentWorkspace({
  subagents,
  selected,
  loading,
  error,
  onSelect,
  onBack,
  onClose,
  renderDetail,
}: {
  subagents: readonly StoredThreadSummary[];
  selected: StoredThreadSummary | null;
  loading: boolean;
  error: string | null;
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
              <Ionicons name="arrow-back" size={22} color={colors.text} />
            </Pressable>
            <View style={styles.headerIdentity}>
              <Text numberOfLines={1} style={styles.headerTitle}>Subagents</Text>
              <Text numberOfLines={1} style={styles.headerSubtitle}>{subagents.length} · newest activity first</Text>
            </View>
          </View>
          <LegendList
            data={subagents}
            recycleItems
            estimatedItemSize={66}
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
        <View testID="subagent-detail-pane" style={styles.detail}>
          {selected === null
            ? <EmptySelection />
            : loading || error !== null
              ? <PendingDetail summary={selected} compact={compact} loading={loading} error={error} onBack={onBack} onClose={onClose} />
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
      <View style={styles.avatar}>
        <Ionicons name="people-outline" size={19} color={active ? colors.green : colors.textMuted} />
      </View>
      <View style={styles.rowText}>
        <View style={styles.rowTitleLine}>
          {active
            ? <WaveText testID={`subagent-active-${summary.remoteThreadId}`} text={title} style={styles.rowTitle} containerStyle={styles.rowTitleWave} />
            : <Text numberOfLines={1} style={styles.rowTitle}>{title}</Text>}
          <Text style={styles.time}>{formatTime(summary.recencyAt ?? summary.updatedAt)}</Text>
        </View>
        <Text numberOfLines={1} ellipsizeMode="tail" style={styles.preview}>
          {subagentSubtitle(summary)}
        </Text>
      </View>
    </Pressable>
  );
}

function PendingDetail({
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
            <Ionicons name="arrow-back" size={22} color={colors.text} />
          </Pressable>
        )}
        <View style={styles.headerIdentity}>
          <Text numberOfLines={1} style={styles.headerTitle}>{subagentDisplayName(summary)}</Text>
          <Text numberOfLines={1} style={styles.headerSubtitle}>{subagentSubtitle(summary)}</Text>
        </View>
        {!compact && (
          <Pressable accessibilityLabel="Close subagents" onPress={onClose} style={styles.iconButton}>
            <Ionicons name="close" size={22} color={colors.text} />
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
      <Ionicons name="chatbubbles-outline" size={30} color={colors.textDim} />
      <Text style={styles.muted}>Select a subagent</Text>
    </View>
  );
}

function EmptySubagents() {
  return (
    <View style={styles.empty}>
      <Ionicons name="people-outline" size={28} color={colors.textDim} />
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

function formatTime(timestamp: number): string {
  return new Date(timestamp * 1_000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function subagentRowsEqual(left: StoredThreadSummary, right: StoredThreadSummary): boolean {
  return left === right || (
    left.remoteThreadId === right.remoteThreadId
    && left.name === right.name
    && left.agentNickname === right.agentNickname
    && left.agentRole === right.agentRole
    && left.status.type === right.status.type
    && left.updatedAt === right.updatedAt
    && left.recencyAt === right.recencyAt
  );
}

const styles = StyleSheet.create({
  workspace: { flex: 1, minWidth: 0, minHeight: 0, flexDirection: "row", backgroundColor: colors.background },
  master: { minWidth: 0, minHeight: 0, backgroundColor: colors.surface },
  detail: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: colors.background },
  masterHeader: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm },
  detailHeader: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.xs },
  headerIdentity: { flex: 1, minWidth: 0 },
  headerTitle: { color: colors.text, ...typeScale.titleMedium },
  headerSubtitle: { color: colors.textMuted, ...typeScale.labelMedium },
  iconButton: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  listContent: { paddingHorizontal: spacing.xs, paddingBottom: spacing.md },
  row: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.xs, paddingVertical: spacing.xs, borderRadius: radii.selected },
  rowSelected: { backgroundColor: colors.surfaceContainerHighest },
  pressed: { backgroundColor: colors.surfaceHover },
  avatar: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceContainer },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowTitleLine: { minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  rowTitle: { minWidth: 0, flexShrink: 1, color: colors.text, fontSize: 14, lineHeight: 19, fontWeight: "700" },
  rowTitleWave: { flex: 1 },
  time: { flexShrink: 0, color: colors.textDim, fontSize: 10, lineHeight: 14, fontVariant: ["tabular-nums"] },
  preview: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
  pendingPane: { flex: 1, minHeight: 0 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  empty: { minHeight: 180, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  muted: { color: colors.textMuted, ...typeScale.bodyMedium },
  error: { color: colors.red, padding: spacing.sm, ...typeScale.bodyMedium },
});
