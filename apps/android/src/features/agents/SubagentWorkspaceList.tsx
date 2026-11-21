import { LegendList, type LegendListRef } from "@legendapp/list/react-native";
import type { Ref, RefObject } from "react";
import { View } from "react-native";
import type { StoredThreadSummary } from "../../data/thread-summary-types";
import { useEvent } from "../../react/useEvent";
import { AppText as Text } from "../../ui/Typography";
import { EmptySubagents } from "./SubagentPendingDetail";
import { SUBAGENT_ROW_HEIGHT } from "./SubagentWorkspace.constants";
import { styles } from "./SubagentWorkspace.styles";
import type { SubagentLineage, SubagentWorkspaceItem } from "./lineageProjection";
import { SubagentRow } from "./SubagentRow";
import {
  subagentWorkspaceItemSize,
  subagentWorkspaceItemsEqual,
} from "./subagentWorkspaceListModel";

/** Owns virtualized subagent item rendering while the pane owns restoration and composition. */
export function SubagentWorkspaceList({
  items,
  listRef,
  onSelect,
  restoredRowRef,
  restoreFocusThreadId,
  selectedThreadId,
}: {
  readonly items: readonly SubagentWorkspaceItem[];
  readonly listRef: RefObject<LegendListRef | null>;
  readonly onSelect: (summary: StoredThreadSummary) => void;
  readonly restoredRowRef: Ref<View>;
  readonly restoreFocusThreadId: string | null;
  readonly selectedThreadId: string | null;
}): React.JSX.Element {
  return (
    <LegendList
      contentContainerStyle={styles.listContent}
      data={items}
      drawDistance={360}
      estimatedItemSize={SUBAGENT_ROW_HEIGHT}
      extraData={selectedThreadId}
      getFixedItemSize={subagentWorkspaceItemSize}
      getItemType={(item) => item.kind}
      itemsAreEqual={subagentWorkspaceItemsEqual}
      keyExtractor={(item) => item.key}
      ListEmptyComponent={<EmptySubagents />}
      recycleItems
      ref={listRef}
      renderItem={({ item }) => (
        <SubagentWorkspaceListItem
          item={item}
          onSelect={onSelect}
          restoredRowRef={restoredRowRef}
          restoreFocusThreadId={restoreFocusThreadId}
          selectedThreadId={selectedThreadId}
        />
      )}
      testID="subagent-list"
    />
  );
}

function SubagentWorkspaceListItem({
  item,
  onSelect,
  restoredRowRef,
  restoreFocusThreadId,
  selectedThreadId,
}: {
  readonly item: SubagentWorkspaceItem;
  readonly onSelect: (summary: StoredThreadSummary) => void;
  readonly restoredRowRef: Ref<View>;
  readonly restoreFocusThreadId: string | null;
  readonly selectedThreadId: string | null;
}): React.JSX.Element {
  if (item.kind === "boundary") {
    return (
      <View
        accessible={false}
        importantForAccessibility="no"
        style={styles.lineageBoundary}
        testID="subagent-lineage-boundary"
      >
        <View style={styles.lineageBoundaryRule} />
      </View>
    );
  }
  if (item.kind === "section") {
    return (
      <View style={styles.lineageSection} testID="subagent-lineage-section">
        <Text numberOfLines={1} style={styles.lineageSectionLabel}>
          {item.label}
        </Text>
      </View>
    );
  }
  return (
    <SubagentWorkspaceRow
      lineage={item.row.lineage}
      onSelect={onSelect}
      restoredRowRef={restoredRowRef}
      restoreFocusThreadId={restoreFocusThreadId}
      selectedThreadId={selectedThreadId}
      summary={item.row.summary}
    />
  );
}

function SubagentWorkspaceRow({
  lineage,
  onSelect,
  restoredRowRef,
  restoreFocusThreadId,
  selectedThreadId,
  summary,
}: {
  readonly lineage: SubagentLineage;
  readonly onSelect: (summary: StoredThreadSummary) => void;
  readonly restoredRowRef: Ref<View>;
  readonly restoreFocusThreadId: string | null;
  readonly selectedThreadId: string | null;
  readonly summary: StoredThreadSummary;
}): React.JSX.Element {
  const open = useEvent((): void => {
    onSelect(summary);
  });
  const restoresFocus = summary.remoteThreadId === restoreFocusThreadId;
  return (
    <SubagentRow
      {...(restoresFocus ? { focusRef: restoredRowRef } : {})}
      lineage={lineage}
      onPress={open}
      selected={summary.remoteThreadId === selectedThreadId}
      summary={summary}
    />
  );
}
