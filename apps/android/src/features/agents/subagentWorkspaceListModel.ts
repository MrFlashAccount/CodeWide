import type { StoredThreadSummary } from "../../data/thread-summary-types";
import {
  SUBAGENT_BOUNDARY_HEIGHT,
  SUBAGENT_ROW_HEIGHT,
  SUBAGENT_SECTION_HEIGHT,
} from "./SubagentWorkspace.constants";
import type { SubagentLineage, SubagentWorkspaceItem } from "./lineageProjection";
import { subagentRowsEqual } from "./SubagentRow";

export function subagentWorkspaceItemsEqual(
  left: SubagentWorkspaceItem,
  right: SubagentWorkspaceItem,
): boolean {
  if (left.kind === "boundary") {
    return boundaryItemsEqual(left, right);
  }
  if (left.kind === "section") {
    return sectionItemsEqual(left, right);
  }
  return subagentItemsEqual(left, right);
}

export function subagentWorkspaceItemSize(item: SubagentWorkspaceItem): number {
  if (item.kind === "boundary") {
    return SUBAGENT_BOUNDARY_HEIGHT;
  }
  return item.kind === "section" ? SUBAGENT_SECTION_HEIGHT : SUBAGENT_ROW_HEIGHT;
}

export function selectedSubagentItemIndex(
  items: readonly SubagentWorkspaceItem[],
  selected: StoredThreadSummary | null,
): number {
  if (selected === null) {
    return -1;
  }
  return items.findIndex(
    (item) =>
      item.kind === "subagent" && item.row.summary.remoteThreadId === selected.remoteThreadId,
  );
}

function subagentLineagesEqual(left: SubagentLineage, right: SubagentLineage): boolean {
  if (left.status === "unknown") {
    return right.status === "unknown";
  }
  return (
    right.status === "known" &&
    sameThreadPath(left.parentThreadIds, right.parentThreadIds) &&
    sameThreadPath(left.parentLabels, right.parentLabels)
  );
}

function boundaryItemsEqual(
  left: Extract<SubagentWorkspaceItem, { readonly kind: "boundary" }>,
  right: SubagentWorkspaceItem,
): boolean {
  return right.kind === "boundary" && left.key === right.key;
}

function sectionItemsEqual(
  left: Extract<SubagentWorkspaceItem, { readonly kind: "section" }>,
  right: SubagentWorkspaceItem,
): boolean {
  return (
    right.kind === "section" &&
    sameThreadPath(left.parentThreadIds, right.parentThreadIds) &&
    left.label === right.label
  );
}

function subagentItemsEqual(
  left: Extract<SubagentWorkspaceItem, { readonly kind: "subagent" }>,
  right: SubagentWorkspaceItem,
): boolean {
  return (
    right.kind === "subagent" &&
    subagentLineagesEqual(left.row.lineage, right.row.lineage) &&
    subagentRowsEqual(left.row.summary, right.row.summary)
  );
}

function sameThreadPath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
