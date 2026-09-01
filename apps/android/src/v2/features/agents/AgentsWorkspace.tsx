import { Ionicons } from "@expo/vector-icons";
import { LegendList, type LegendListRenderItemProps } from "@legendapp/list/react-native";
import { type ReactNode, useState } from "react";
import {
  Pressable,
  type PressableStateCallbackType,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from "react-native";

import { ProductText as Text } from "../../presentation/text/ProductText";
import { useEvent } from "../../../react/useEvent";
import { colors, radii, spacing, typeScale, typeWeight } from "../../theme";

const MASTER_DETAIL_BREAKPOINT = 720;
const MASTER_MIN_WIDTH = 280;
const MASTER_MAX_WIDTH = 360;

export interface AgentWorkspaceRow {
  active: boolean;
  id: string;
  subtitle: string;
  time: string;
  title: string;
}

interface AgentsWorkspaceProps {
  detail: ReactNode;
  onClose(): void;
  onSelect(id: string): void;
  rows: AgentWorkspaceRow[];
  selectedId: string | null;
}

interface AgentRowProps {
  onSelect(id: string): void;
  row: AgentWorkspaceRow;
  selected: boolean;
}

interface RenderableAgentWorkspaceRow extends AgentWorkspaceRow {
  onSelect(id: string): void;
  selected: boolean;
}

export function AgentsWorkspace(props: AgentsWorkspaceProps): React.JSX.Element {
  const { detail, onClose, onSelect, rows, selectedId } = props;
  const window = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const width = measuredWidth > 0 ? measuredWidth : window.width;
  const compact = width < MASTER_DETAIL_BREAKPOINT;
  const showMaster = !compact || selectedId === null;
  const showDetail = !compact || selectedId !== null;
  const masterWidth = compact
    ? width
    : Math.min(MASTER_MAX_WIDTH, Math.max(MASTER_MIN_WIDTH, Math.floor(width * 0.32)));
  const measure = useEvent((event: LayoutChangeEvent) => {
    const next = Math.floor(event.nativeEvent.layout.width);
    setMeasuredWidth((current) => (current === next ? current : next));
  });
  const renderableRows = rows.map((row): RenderableAgentWorkspaceRow => ({
    ...row,
    onSelect,
    selected: row.id === selectedId,
  }));

  return (
    <View testID="v2-agents-workspace" style={styles.workspace} onLayout={measure}>
      {showMaster ? (
        <View testID="v2-agents-master-pane" style={[styles.master, { width: masterWidth }]}>
          <View style={styles.masterHeader}>
            <Pressable
              accessibilityLabel="Back to conversation"
              onPress={onClose}
              style={styles.iconButton}
            >
              <Ionicons color={colors.text} name="arrow-back" size={22} />
            </Pressable>
            <View style={styles.headerIdentity}>
              <Text numberOfLines={1} style={styles.headerTitle}>
                Subagents
              </Text>
              <Text numberOfLines={1} style={styles.headerSubtitle}>
                {rows.length} · newest activity first
              </Text>
            </View>
          </View>
          <LegendList
            contentContainerStyle={styles.listContent}
            data={renderableRows}
            drawDistance={360}
            estimatedItemSize={66}
            extraData={selectedId}
            itemsAreEqual={agentRowsEqual}
            keyExtractor={agentKey}
            ListEmptyComponent={<EmptyAgents />}
            recycleItems
            renderItem={renderAgent}
          />
        </View>
      ) : null}
      {showDetail ? (
        <View testID="v2-agents-detail-pane" style={styles.detail}>
          {selectedId === null ? <EmptySelection /> : detail}
        </View>
      ) : null}
    </View>
  );
}

function renderAgent(
  value: LegendListRenderItemProps<RenderableAgentWorkspaceRow>,
): React.JSX.Element {
  const { item } = value;
  return <AgentRow onSelect={item.onSelect} row={item} selected={item.selected} />;
}

function AgentRow(props: AgentRowProps): React.JSX.Element {
  const { onSelect, row, selected } = props;
  const open = useEvent(() => onSelect(row.id));
  const style = selected ? selectedRowStyle : rowStyle;
  return (
    <Pressable
      accessibilityLabel={`Open subagent ${row.title}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={open}
      style={style}
    >
      <View style={styles.avatar}>
        <Ionicons
          color={row.active ? colors.green : colors.textMuted}
          name="people-outline"
          size={19}
        />
      </View>
      <View style={styles.rowText}>
        <View style={styles.rowTitleLine}>
          <Text numberOfLines={1} style={styles.rowTitle}>
            {row.title}
          </Text>
          <Text style={styles.time}>{row.time}</Text>
        </View>
        <Text ellipsizeMode="tail" numberOfLines={1} style={styles.preview}>
          {row.subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

function EmptySelection(): React.JSX.Element {
  return (
    <View style={styles.center}>
      <Ionicons color={colors.textDim} name="chatbubbles-outline" size={30} />
      <Text style={styles.muted}>Select a subagent</Text>
    </View>
  );
}

function EmptyAgents(): React.JSX.Element {
  return (
    <View style={styles.empty}>
      <Ionicons color={colors.textDim} name="people-outline" size={28} />
      <Text style={styles.muted}>No subagents in this thread</Text>
    </View>
  );
}

function agentKey(row: AgentWorkspaceRow): string {
  return row.id;
}

function agentRowsEqual(left: AgentWorkspaceRow, right: AgentWorkspaceRow): boolean {
  return (
    left === right ||
    (left.id === right.id &&
      left.title === right.title &&
      left.subtitle === right.subtitle &&
      left.active === right.active &&
      left.time === right.time)
  );
}

function selectedRowStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.row, styles.rowSelected, pressed && styles.pressed];
}

function rowStyle(state: PressableStateCallbackType) {
  const { pressed } = state;
  return [styles.row, pressed && styles.pressed];
}

const styles = StyleSheet.create({
  workspace: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    flexDirection: "row",
    backgroundColor: colors.background,
  },
  master: { minWidth: 0, minHeight: 0, backgroundColor: colors.surface },
  detail: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: colors.background },
  masterHeader: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  headerIdentity: { flex: 1, minWidth: 0 },
  headerTitle: { color: colors.text, ...typeScale.title },
  headerSubtitle: { color: colors.textMuted, ...typeScale.label },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  listContent: { paddingHorizontal: spacing.xs, paddingBottom: spacing.md },
  row: {
    minHeight: 66,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    borderRadius: radii.selected,
  },
  rowSelected: { backgroundColor: colors.surfaceContainerHighest },
  pressed: { backgroundColor: colors.surfaceHover },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceContainer,
  },
  rowText: { flex: 1, minWidth: 0, gap: spacing.optical },
  rowTitleLine: { minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  rowTitle: {
    minWidth: 0,
    flexShrink: 1,
    color: colors.text,
    ...typeScale.body,

    fontWeight: typeWeight.semibold,
  },
  time: {
    flexShrink: 0,
    color: colors.textDim,
    ...typeScale.caption,

    fontVariant: ["tabular-nums"],
  },
  preview: { color: colors.textMuted, ...typeScale.label },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  empty: { minHeight: 180, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  muted: { color: colors.textMuted, ...typeScale.body },
});
