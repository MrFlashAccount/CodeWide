import { subagentDisplayName } from "../../data/subagent-projection";
import type { StoredThreadSummary } from "../../data/thread-summary-types";

export type KnownSubagentLineage = {
  readonly depth: number;
  readonly groupLabel: string;
  readonly immediateParentLabel: string;
  readonly parentLabels: readonly string[];
  readonly parentThreadIds: readonly string[];
  readonly rootLabel: string;
  readonly status: "known";
};

export type SubagentLineage = KnownSubagentLineage | { readonly status: "unknown" };

export type SubagentLineageRow = {
  readonly lineage: SubagentLineage;
  readonly summary: StoredThreadSummary;
};

export type SubagentWorkspaceItem =
  | {
      readonly key: string;
      readonly kind: "boundary";
    }
  | {
      readonly key: string;
      readonly kind: "section";
      readonly label: string;
      readonly parentThreadIds: readonly string[];
    }
  | {
      readonly key: string;
      readonly kind: "subagent";
      readonly row: SubagentLineageRow;
    };

/** Derives display-only lineage from captured real thread labels without changing row order. */
export function projectSubagentLineage(
  summaries: readonly StoredThreadSummary[],
  rootThreadId: string,
  rootThreadLabel: string | null,
): readonly SubagentLineageRow[] {
  const rootLabel = nonEmpty(rootThreadLabel);
  if (rootLabel === null) {
    return summaries.map((summary) => ({ lineage: { status: "unknown" }, summary }));
  }
  const resolvedRootLabel: string = rootLabel;
  const byThreadId = new Map(summaries.map((summary) => [summary.remoteThreadId, summary]));
  const resolved = new Map<string, SubagentLineage>();
  const resolving = new Set<string>();

  function resolve(summary: StoredThreadSummary): SubagentLineage {
    const cached = resolved.get(summary.remoteThreadId);
    if (cached !== undefined) {
      return cached;
    }
    if (resolving.has(summary.remoteThreadId)) {
      return { status: "unknown" };
    }
    resolving.add(summary.remoteThreadId);
    const lineage = resolveParentLineage(summary);
    resolving.delete(summary.remoteThreadId);
    resolved.set(summary.remoteThreadId, lineage);
    return lineage;
  }

  function resolveParentLineage(summary: StoredThreadSummary): SubagentLineage {
    const parentThreadId = summary.parentThreadId;
    if (parentThreadId === rootThreadId) {
      return knownLineage([rootThreadId], [resolvedRootLabel]);
    }
    if (parentThreadId === null) {
      return { status: "unknown" };
    }
    const parent = byThreadId.get(parentThreadId);
    if (parent === undefined) {
      return { status: "unknown" };
    }
    const parentLineage = resolve(parent);
    return parentLineage.status === "unknown"
      ? { status: "unknown" }
      : knownLineage(
          [...parentLineage.parentThreadIds, parent.remoteThreadId],
          [...parentLineage.parentLabels, subagentDisplayName(parent)],
        );
  }

  return summaries.map((summary) => ({ lineage: resolve(summary), summary }));
}

export function subagentLineageAccessibility(lineage: KnownSubagentLineage): string {
  return lineage.depth === 1
    ? `child of ${lineage.immediateParentLabel}, depth 1`
    : `child of ${lineage.immediateParentLabel}, depth ${String(lineage.depth)} under ${lineage.rootLabel}`;
}

export function subagentParentBreadcrumb(lineage: SubagentLineage): string | null {
  return lineage.status === "known" ? `From ${lineage.groupLabel}` : null;
}

/** Inserts quiet sections at real lineage boundaries without reordering child rows. */
export function projectSubagentWorkspaceItems(
  rows: readonly SubagentLineageRow[],
): readonly SubagentWorkspaceItem[] {
  const items: SubagentWorkspaceItem[] = [];
  let previousParentThreadIds: readonly string[] | null = null;
  let previousStatus: SubagentLineage["status"] | null = null;
  for (const row of rows) {
    const status = row.lineage.status;
    if (previousStatus !== null && status !== previousStatus) {
      const identity =
        row.lineage.status === "known" ? lineagePathKey(row.lineage.parentThreadIds) : "unknown";
      items.push({
        key: `lineage-boundary:${identity}:${row.summary.remoteThreadId}`,
        kind: "boundary",
      });
    }
    if (row.lineage.status === "known") {
      if (!sameThreadPath(row.lineage.parentThreadIds, previousParentThreadIds)) {
        items.push({
          key: `lineage:${lineagePathKey(row.lineage.parentThreadIds)}:${row.summary.remoteThreadId}`,
          kind: "section",
          label: row.lineage.groupLabel,
          parentThreadIds: row.lineage.parentThreadIds,
        });
      }
      previousParentThreadIds = row.lineage.parentThreadIds;
    } else {
      previousParentThreadIds = null;
    }
    items.push({ key: row.summary.remoteThreadId, kind: "subagent", row });
    previousStatus = status;
  }
  return items;
}

function knownLineage(
  parentThreadIds: readonly string[],
  labels: readonly string[],
): KnownSubagentLineage {
  return {
    depth: labels.length,
    groupLabel: labels.join(" › "),
    immediateParentLabel: labels.at(-1) ?? "",
    parentLabels: labels,
    parentThreadIds,
    rootLabel: labels[0] ?? "",
    status: "known",
  };
}

function sameThreadPath(left: readonly string[], right: readonly string[] | null): boolean {
  return (
    right !== null && left.length === right.length && left.every((id, index) => id === right[index])
  );
}

function lineagePathKey(parentThreadIds: readonly string[]): string {
  return parentThreadIds.map((id) => `${String(id.length)}:${id}`).join("");
}

function nonEmpty(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}
