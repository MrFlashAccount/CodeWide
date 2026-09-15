import { Ionicons } from "@expo/vector-icons";
import { LegendList } from "@legendapp/list/react-native";
import { type ReactNode, useState } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";
import type { StoredThreadSummary } from "../../data/thread-summary-types";
import { colors, iconSize } from "../../theme";
import { threadListLayout } from "../../ui/thread-list-layout";
import { AppText as Text } from "../../ui/Typography";
import { EmptySelection, EmptySubagents } from "./SubagentPendingDetail";
import { SubagentRow, subagentRowsEqual } from "./SubagentRow";
import { styles } from "./SubagentWorkspace.styles";

export const MASTER_DETAIL_BREAKPOINT = 720;

export const MASTER_MIN_WIDTH = 280;

export const MASTER_MAX_WIDTH = 360;

export const SUBAGENT_ROW_HEIGHT =
  threadListLayout.rowContentHeight + threadListLayout.rowVerticalMargin * 2;

/** Composes the selectable subagent list and active subagent detail. */
export function SubagentWorkspace({
  subagents,
  selected,
  onSelect,
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
        setMeasuredWidth((current) => (current === next ? current : next));
      }}
    >
      {showMaster && (
        <View testID="subagent-master-pane" style={[styles.master, { width: masterWidth }]}>
          <View style={styles.masterHeader}>
            <Pressable
              accessibilityLabel="Back to conversation"
              onPress={onClose}
              style={styles.iconButton}
            >
              <Ionicons name="arrow-back" size={iconSize.navigation} color={colors.text} />
            </Pressable>
            <Text numberOfLines={1} style={[styles.headerTitle, styles.masterTitle]}>
              Subagents
            </Text>
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
          {selected === null ? <EmptySelection /> : renderDetail(compact)}
        </View>
      )}
    </View>
  );
}
