import type { Turn } from "@codewide/codex-protocol/v0.155.1/v2";
import {
  projectedActivityMetrics,
  projectedTurnMetadata,
  type ActivitySummary,
} from "@codewide/sync-client";

/** Shows unloaded history only when Companion declares visible activity. */
export function hasCompletedTurnHistory(turn: Turn, historyIndexes: readonly number[]): boolean {
  if (hasHistoryContent(turn, historyIndexes)) {
    return true;
  }
  // Full content is authoritative even when an older summary still counts hidden thinking.
  if (turn.itemsView === "full") {
    return false;
  }
  const summary = projectedActivityMetrics(turn)?.total ?? projectedTurnMetadata(turn)?.activity;
  return summary !== undefined && summaryHasVisibleHistory(summary);
}

function hasHistoryContent(turn: Turn, historyIndexes: readonly number[]): boolean {
  const metadata = projectedTurnMetadata(turn);
  return (
    historyIndexes.some((index) => hasHistoryItem(turn, index)) ||
    metadata?.plan !== undefined ||
    metadata?.diff !== undefined
  );
}

function hasHistoryItem(turn: Turn, index: number): boolean {
  const item = turn.items[index];
  // Thinking is already excluded by the completed render window. Match
  // chronologicalTurnSequence's additional omission of blank agent placeholders.
  return item !== undefined && (item.type !== "agentMessage" || item.text.trim() !== "");
}

function summaryHasVisibleHistory(summary: Pick<ActivitySummary, "count" | "kinds">): boolean {
  return (
    summary.count > 0 &&
    (summary.kinds.length === 0 || summary.kinds.some((kind) => kind !== "reasoning"))
  );
}
