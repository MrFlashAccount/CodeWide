import { threadHistoryContainsBeginning } from "./thread-pagination";
import type { ThreadDetailRow } from "./thread-detail-projection";
import type { ThreadChatWindowView } from "./use-thread-chat-window";

/** Which remote history edges are actually present in one installed chat window. */
export type ThreadWindowHistoryBounds = Readonly<{
  completeTurnHeaders: boolean;
  containsBeginning: boolean;
  containsLatest: boolean;
}>;

/** Reads the Companion cursor and the rows it covers from the same window revision. */
export function threadWindowHistoryBounds(window: ThreadChatWindowView): ThreadWindowHistoryBounds {
  const { liveRows, snapshot, turnRows } = window;
  const meta = liveRows.find(
    (row) => row.kind === "thread" && row.historyEpoch === snapshot.historyEpoch,
  );
  const containsBeginning = meta !== undefined && windowContainsBeginning(window, meta);
  const latest = snapshot.latestSealedOrdinal;
  const containsLatest =
    latest === null ||
    turnRows.some(
      (row) =>
        row.kind === "turn" && row.historyEpoch === snapshot.historyEpoch && row.ordinal === latest,
    );
  return {
    completeTurnHeaders: containsBeginning && containsLatest,
    containsBeginning,
    containsLatest,
  };
}

function windowContainsBeginning(window: ThreadChatWindowView, meta: ThreadDetailRow): boolean {
  const oldest = meta.historyCoverageMinOrdinal;
  if (typeof oldest !== "number") {
    return threadHistoryContainsBeginning(
      oldest === null && meta.historyHadTurns === false,
      meta.historyCursor,
    );
  }
  const earliestSealed = window.snapshot.earliestSealedOrdinal;
  if (earliestSealed !== null && earliestSealed < oldest) {
    return false;
  }
  const isOldest = (row: ThreadDetailRow) =>
    row.kind === "turn" &&
    row.turn !== null &&
    row.historyEpoch === meta.historyEpoch &&
    row.ordinal === oldest;
  return threadHistoryContainsBeginning(
    window.turnRows.some(isOldest) || window.liveRows.some(isOldest),
    meta.historyCursor,
  );
}
