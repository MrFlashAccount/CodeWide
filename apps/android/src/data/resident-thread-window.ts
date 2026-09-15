import type { ThreadChatWindowRequest, ThreadChatWindowSnapshot } from "./thread-chat-model";
import type { ThreadDetailRow } from "./thread-detail-projection";
import type { ResolvedThreadDetailWindow } from "./thread-detail-sqlite.native";
import { THREAD_HISTORY_PAGE_SIZE, THREAD_RESIDENT_TURN_LIMIT } from "./thread-pagination";

/** Reuse resident rows only when they cover the requested durable history range.
 * A live head alone is not evidence that the preceding history is resident. */
export function residentThreadWindow(
  request: ThreadChatWindowRequest,
  rows: readonly ThreadDetailRow[],
  previous: ThreadChatWindowSnapshot,
): ResolvedThreadDetailWindow | null {
  const meta = rows.find((row) => row.kind === "thread");
  if (meta === undefined || meta.historyCursor === undefined) return null;
  const minimum = meta.historyCoverageMinOrdinal;
  const maximum = meta.historyCoverageMaxOrdinal;
  if (minimum === undefined || maximum === undefined) return null;
  const currentRows = rows.filter(
    (row) => row.kind === "pending" || row.historyEpoch === meta.historyEpoch,
  );
  const sealed = currentRows.filter((row) => row.kind === "turn" && row.sealed);
  const anchor =
    request.anchorTurnId === null
      ? null
      : currentRows.find((row) => row.kind === "turn" && row.remoteTurnId === request.anchorTurnId);
  if (anchor === undefined) return null;
  if (minimum === null || maximum === null) {
    if (minimum !== null || maximum !== null || sealed.length !== 0 || meta.historyCursor !== null)
      return null;
    if (meta.historyHadTurns !== false) return null;
  }
  const end =
    maximum === null
      ? null
      : anchor?.sealed === true
        ? Math.min(maximum, anchor.ordinal + THREAD_HISTORY_PAGE_SIZE)
        : maximum;
  const start =
    minimum === null || end === null
      ? null
      : Math.max(minimum, end - THREAD_RESIDENT_TURN_LIMIT + 1);
  const turnRows = sealed.filter(
    (row) => start !== null && end !== null && row.ordinal >= start && row.ordinal <= end,
  );
  const ordinals = new Set(turnRows.filter((row) => row.turn !== null).map((row) => row.ordinal));
  if (start !== null && end !== null) {
    for (let ordinal = start; ordinal <= end; ordinal += 1) {
      if (!ordinals.has(ordinal)) return null;
    }
  }
  turnRows.sort((left, right) => right.ordinal - left.ordinal);
  const sameHistory = previous.historyEpoch === meta.historyEpoch;
  const previousMin = sameHistory ? previous.earliestSealedOrdinal : null;
  const previousMax = sameHistory ? previous.latestSealedOrdinal : null;
  return {
    historyEpoch: meta.historyEpoch,
    latestSealedOrdinal: maximum === null ? null : Math.max(previousMax ?? maximum, maximum),
    earliestSealedOrdinal: minimum === null ? null : Math.min(previousMin ?? minimum, minimum),
    turnRows,
    detailRows: currentRows.filter(
      (row) =>
        row.sealed &&
        (row.kind === "turnMeta" || row.kind === "activity") &&
        ordinals.has(row.ordinal),
    ),
    liveRows: currentRows.filter((row) => !row.sealed),
  };
}
