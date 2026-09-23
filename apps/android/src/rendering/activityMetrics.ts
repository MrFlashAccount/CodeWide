import type { Turn } from "@codewide/codex-protocol/v0.155.1/v2";
import type { RenderBlock } from "@codewide/renderers";
import {
  activityRange,
  projectedActivityMetrics,
  projectedItemActivityRange,
  type ActivityMetrics,
  type ActivitySummary,
} from "@codewide/sync-client";

/** Selects a ready server summary for the exact rendered activity range. */
export function blockActivitySummary(
  blocks: readonly RenderBlock[],
  metrics: ActivityMetrics | null,
): ActivitySummary | null {
  const first = blocks[0]?.raw;
  const last = blocks.at(-1)?.raw;
  const projected = activityRange(metrics, first?.id, last?.id);
  if (projected !== null || first === undefined) {
    return projected;
  }
  return projectedItemActivityRange(first, last?.id);
}

/** Uses endpoints only; indexes never become locally computed display counters. */
export function collapsedActivitySummary(
  turn: Turn,
  indexes: readonly number[],
): ActivitySummary | null {
  const first = turn.items[indexes[0] ?? -1]?.id;
  const last = turn.items[indexes.at(-1) ?? -1]?.id;
  return activityRange(projectedActivityMetrics(turn), first, last);
}
