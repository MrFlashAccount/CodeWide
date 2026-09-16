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
  onClose,
  onSelect,
  renderDetail,
  selected,
  subagents,
}: {
  onBack: () => void;
  onClose: () => void;
  onSelect: (summary: StoredThreadSummary) => void;
  renderDetail: (compact: boolean) => ReactNode;
  selected: StoredThreadSummary | null;
  subagents: readonly StoredThreadSummary[];
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
      onLayout={({ nativeEvent }) => {
        const next = Math.floor(nativeEvent.layout.width);
        setMeasuredWidth((current) => (current === next ? current : next));
      }}
      style={styles.workspace}
      testID="subagent-workspace"
    >
      {showMaster && (
        <View style={[styles.master, { width: masterWidth }]} testID="subagent-master-pane">
          <View style={styles.masterHeader}>
            <Pressable
              accessibilityLabel="Back to conversation"
              onPress={onClose}
              style={styles.iconButton}
            >
              <Ionicons color={colors.text} name="arrow-back" size={iconSize.navigation} />
            </Pressable>
            <Text numberOfLines={1} style={[styles.headerTitle, styles.masterTitle]}>
              Subagents
            </Text>
            <Text
              accessibilityLabel={`${String(subagents.length)} ${subagents.length === 1 ? "subagent" : "subagents"}`}
              style={styles.headerCount}
            >
              {subagents.length}
            </Text>
          </View>
          <LegendList
            contentContainerStyle={styles.listContent}
            data={subagents}
            drawDistance={360}
            estimatedItemSize={SUBAGENT_ROW_HEIGHT}
            extraData={selected?.remoteThreadId ?? null}
            getFixedItemSize={() => SUBAGENT_ROW_HEIGHT}
            itemsAreEqual={subagentRowsEqual}
            keyExtractor={(summary) => summary.remoteThreadId}
            ListEmptyComponent={<EmptySubagents />}
            recycleItems
            renderItem={({ item }) => (
              <SubagentRow
                onPress={() => {
                  onSelect(item);
                }}
                selected={item.remoteThreadId === selected?.remoteThreadId}
                summary={item}
              />
            )}
          />
        </View>
      )}
      {showDetail && (
        <View
          style={[styles.detail, !compact && styles.detailRaised]}
          testID="subagent-detail-pane"
        >
          {selected === null ? <EmptySelection /> : renderDetail(compact)}
        </View>
      )}
    </View>
  );
}
