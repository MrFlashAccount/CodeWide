import type { ReactNode } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import type { StoredThreadSummary } from "../../data/thread-summary-types";
import { SubagentMasterPane } from "./SubagentMasterPane";
import { EmptySelection } from "./SubagentPendingDetail";
import { projectSubagentWorkspaceItems, type SubagentLineageRow } from "./lineageProjection";
import { styles } from "./SubagentWorkspace.styles";

export {
  MASTER_DETAIL_BREAKPOINT,
  MASTER_MAX_WIDTH,
  MASTER_MIN_WIDTH,
  SUBAGENT_ROW_HEIGHT,
  SUBAGENT_SECTION_HEIGHT,
} from "./SubagentWorkspace.constants";

/** Composes the selectable subagent list and active subagent detail. */
export function SubagentWorkspace({
  children,
  compact,
  detailOpen,
  masterWidth,
  onClose,
  onLayout,
  onSelect,
  restoreFocusThreadId,
  selected,
  subagents,
}: {
  readonly children: ReactNode;
  readonly compact: boolean;
  readonly detailOpen: boolean;
  readonly masterWidth: number;
  readonly onClose: () => void;
  readonly onLayout: (event: LayoutChangeEvent) => void;
  readonly onSelect: (summary: StoredThreadSummary) => void;
  readonly restoreFocusThreadId: string | null;
  readonly selected: StoredThreadSummary | null;
  readonly subagents: readonly SubagentLineageRow[];
}): React.JSX.Element {
  const showMaster = !compact || !detailOpen;
  const showDetail = !compact || detailOpen;
  const items = projectSubagentWorkspaceItems(subagents);

  return (
    <View onLayout={onLayout} style={styles.workspace} testID="subagent-workspace">
      <SubagentMasterPane
        items={items}
        masterWidth={masterWidth}
        onClose={onClose}
        onSelect={onSelect}
        restoreFocusThreadId={restoreFocusThreadId}
        selected={selected}
        show={showMaster}
        subagentCount={subagents.length}
      />
      <SubagentDetailPane compact={compact} selected={selected} show={showDetail}>
        {children}
      </SubagentDetailPane>
    </View>
  );
}

function SubagentDetailPane({
  children,
  compact,
  selected,
  show,
}: {
  readonly children: ReactNode;
  readonly compact: boolean;
  readonly selected: StoredThreadSummary | null;
  readonly show: boolean;
}): React.JSX.Element | null {
  if (!show) {
    return null;
  }
  return (
    <View style={[styles.detail, !compact && styles.detailRaised]} testID="subagent-detail-pane">
      {selected === null ? <EmptySelection /> : children}
    </View>
  );
}
