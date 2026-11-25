import type { LegendListRef } from "@legendapp/list/react-native";
import { useRef } from "react";
import { View } from "react-native";
import type { StoredThreadSummary } from "../../data/thread-summary-types";
import { SubagentMasterHeader } from "./SubagentMasterHeader";
import { styles } from "./SubagentWorkspace.styles";
import type { SubagentWorkspaceItem } from "./lineageProjection";
import { SubagentWorkspaceList } from "./SubagentWorkspaceList";
import { selectedSubagentItemIndex } from "./subagentWorkspaceListModel";
import { useSubagentListRestoration } from "./useSubagentListRestoration";

export function SubagentMasterPane({
  items,
  masterWidth,
  onClose,
  onSelect,
  restoreFocusThreadId,
  selected,
  show,
  subagentCount,
}: {
  readonly items: readonly SubagentWorkspaceItem[];
  readonly masterWidth: number;
  readonly onClose: () => void;
  readonly onSelect: (summary: StoredThreadSummary) => void;
  readonly restoreFocusThreadId: string | null;
  readonly selected: StoredThreadSummary | null;
  readonly show: boolean;
  readonly subagentCount: number;
}): React.JSX.Element {
  const selectedIndex = selectedSubagentItemIndex(items, selected);
  const listRef = useRef<LegendListRef>(null);
  const restoredRowRef = useSubagentListRestoration({
    itemIndex: selectedIndex,
    listRef,
    restoreFocusThreadId,
    show,
  });
  return (
    <View
      accessibilityElementsHidden={!show}
      importantForAccessibility={show ? "auto" : "no-hide-descendants"}
      style={[styles.master, { width: masterWidth }, !show && styles.hiddenPane]}
      testID="subagent-master-pane"
    >
      <SubagentMasterHeader onClose={onClose} subagentCount={subagentCount} />
      <SubagentWorkspaceList
        items={items}
        listRef={listRef}
        onSelect={onSelect}
        restoredRowRef={restoredRowRef}
        restoreFocusThreadId={restoreFocusThreadId}
        selectedThreadId={selected?.remoteThreadId ?? null}
      />
    </View>
  );
}
