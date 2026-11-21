import { useState, useTransition, type ReactNode } from "react";
import { type LayoutChangeEvent, useWindowDimensions } from "react-native";

import { subagentsForThread } from "../../data/subagent-projection";
import type { ThreadDetailDatabase } from "../../data/thread-detail-database";
import type { StoredThreadSummary } from "../../data/thread-summary-types";
import { useEvent } from "../../react/useEvent";
import { SubagentDetail } from "./SubagentDetail";
import {
  MASTER_DETAIL_BREAKPOINT,
  MASTER_MAX_WIDTH,
  MASTER_MIN_WIDTH,
  SubagentWorkspace,
} from "./SubagentWorkspace";
import {
  projectSubagentLineage,
  subagentParentBreadcrumb,
  type SubagentLineageRow,
} from "./lineageProjection";
import type { SubagentThreadView } from "./subagentConversationContract";

const MASTER_WIDTH_RATIO = 0.32;

type SubagentSelection =
  | { readonly selectedThreadId: string | null; readonly status: "list" }
  | { readonly selectedThreadId: string; readonly status: "detail" };

/** Preserves the original V1 master/detail selection and captured-catalog contract. */
export function SubagentSheet({
  connectionId,
  initialThreadId = null,
  onClose,
  parentLabel,
  parentThreadId,
  renderThread,
  summaries,
  threadDetails,
}: {
  readonly connectionId: string;
  readonly initialThreadId?: string | null;
  readonly onClose: () => void;
  readonly parentLabel: string | null;
  readonly parentThreadId: string;
  readonly renderThread: (view: SubagentThreadView) => ReactNode;
  readonly summaries: readonly StoredThreadSummary[];
  readonly threadDetails: ThreadDetailDatabase;
}): React.JSX.Element {
  const [selection, setSelection] = useState<SubagentSelection>(() =>
    initialSelection(initialThreadId),
  );
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const [, startSubagentTransition] = useTransition();
  const window = useWindowDimensions();
  const width = resolvedWidth(measuredWidth, window.width);
  const compact = width < MASTER_DETAIL_BREAKPOINT;
  const masterWidth = resolvedMasterWidth(width, compact);
  const subagents = subagentsForThread(summaries, parentThreadId);
  const lineageRows = projectSubagentLineage(subagents, parentThreadId, parentLabel);
  const selectedRow = findSelectedRow(lineageRows, selection.selectedThreadId);
  const selected = selectedRow?.summary ?? null;
  const parentBreadcrumb = selectedBreadcrumb(selectedRow);
  const detailOpen = selection.status === "detail" && selected !== null;

  const backToList = useEvent((): void => {
    startSubagentTransition(() => {
      setSelection({ selectedThreadId: selected?.remoteThreadId ?? null, status: "list" });
    });
  });
  const close = useEvent((): void => {
    setSelection({ selectedThreadId: null, status: "list" });
    onClose();
  });
  const openById = useEvent((threadId: string): void => {
    startSubagentTransition(() => {
      setSelection({ selectedThreadId: threadId, status: "detail" });
    });
  });
  const selectSubagent = useEvent((summary: StoredThreadSummary): void => {
    openById(summary.remoteThreadId);
  });
  const updateMeasuredWidth = useEvent((event: LayoutChangeEvent): void => {
    const next = Math.floor(event.nativeEvent.layout.width);
    setMeasuredWidth((current) => (current === next ? current : next));
  });
  const detail =
    selected === null ? null : (
      <SubagentDetail
        compact={compact}
        connectionId={connectionId}
        onBack={backToList}
        onClose={close}
        onOpenSubagent={openById}
        parentBreadcrumb={parentBreadcrumb}
        renderThread={renderThread}
        summary={selected}
        threadDetails={threadDetails}
      />
    );

  return (
    <SubagentWorkspace
      compact={compact}
      detailOpen={detailOpen}
      masterWidth={masterWidth}
      onClose={close}
      onLayout={updateMeasuredWidth}
      onSelect={selectSubagent}
      restoreFocusThreadId={selection.status === "list" ? selection.selectedThreadId : null}
      selected={selected}
      subagents={lineageRows}
    >
      {detail}
    </SubagentWorkspace>
  );
}

function initialSelection(initialThreadId: string | null): SubagentSelection {
  return initialThreadId === null
    ? { selectedThreadId: null, status: "list" }
    : { selectedThreadId: initialThreadId, status: "detail" };
}

function resolvedWidth(measuredWidth: number, windowWidth: number): number {
  return measuredWidth > 0 ? measuredWidth : windowWidth;
}

function resolvedMasterWidth(width: number, compact: boolean): number {
  if (compact) {
    return width;
  }
  return Math.min(
    MASTER_MAX_WIDTH,
    Math.max(MASTER_MIN_WIDTH, Math.floor(width * MASTER_WIDTH_RATIO)),
  );
}

function findSelectedRow(
  rows: readonly SubagentLineageRow[],
  selectedThreadId: string | null,
): SubagentLineageRow | null {
  return rows.find((row) => row.summary.remoteThreadId === selectedThreadId) ?? null;
}

function selectedBreadcrumb(row: SubagentLineageRow | null): string | null {
  return row === null ? null : subagentParentBreadcrumb(row.lineage);
}
