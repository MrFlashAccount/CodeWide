import type { ThreadLoadStatus } from "./thread-load-status";

export type ThreadHistoryState = {
  /** History generation whose ordinal range and cursor this state belongs to. */
  historyEpoch: number;
  status: ThreadLoadStatus;
  nextCursor: string | null;
  /** Number of sealed turns retained while this conversation remains open. */
  residentTurnLimit: number;
  /** Highest ordinal in the resident keyset range; null means live tail. */
  residentMaxOrdinal?: number | null;
  error: string | null;
};

/** Small authoritative refresh used once a complete resident range is local. */
export const THREAD_AUTHORITATIVE_TAIL_PAGE_SIZE = 6;
export const THREAD_HISTORY_PAGE_SIZE = 12;
// Transport pages are an RPC/SQLite concern. The UI owns one fixed semantic
// range around a stable turn id and recenters it only near an edge.
export const THREAD_RESIDENT_TURN_LIMIT = THREAD_HISTORY_PAGE_SIZE;
export const THREAD_RESIDENT_RANGE_EDGE = 3;
export const THREAD_RESIDENT_RANGE_NEWER_BUFFER = Math.floor(THREAD_RESIDENT_TURN_LIMIT / 2);

/** A cold or incomplete local range must arrive in one bounded response. The
 * six-turn tail is only a cheap freshness probe after SQLite already owns the
 * full resident range; using it for bootstrap creates a visible multi-page
 * loading staircase. */
export function threadResumePageLimit(cachedTurnCount: number): number {
  return cachedTurnCount >= THREAD_RESIDENT_TURN_LIMIT
    ? THREAD_AUTHORITATIVE_TAIL_PAGE_SIZE
    : THREAD_RESIDENT_TURN_LIMIT;
}

export type ResidentTurnBoundary = {
  /** Highest ordinal in the keyset range; null follows the live tail. */
  maxOrdinal: number | null;
};

export type ResidentTurnRange = ResidentTurnBoundary & {
  turnLimit: number;
};

export type ResidentRangeDirection = "older" | "newer";

export type HistoryCursorPage = {
  nextCursor: string | null;
  acceptedHistory: boolean;
  extendedHistory: boolean;
};

/** Walks past server pages that are already present in the local epoch. The
 * viewport may move only after persistence proves that the epoch minimum was
 * extended; otherwise a restored-middle cursor can replay the cached tail and
 * drive the resident keyset into an empty range. */
export async function consumeDuplicateHistoryPages<T extends HistoryCursorPage>(
  initialCursor: string | null,
  load: (cursor: string) => Promise<T>,
  shouldContinue: () => boolean = () => true,
): Promise<{ page: T | null; nextCursor: string | null; cancelled: boolean }> {
  let cursor = initialCursor;
  let page: T | null = null;
  const consumed = new Set<string>();
  while (cursor !== null) {
    if (!shouldContinue()) return { page, nextCursor: cursor, cancelled: true };
    if (consumed.has(cursor)) throw new Error("History cursor did not advance");
    consumed.add(cursor);
    page = await load(cursor);
    cursor = page.nextCursor;
    if (!page.acceptedHistory) return { page, nextCursor: cursor, cancelled: true };
    if (!shouldContinue()) return { page, nextCursor: cursor, cancelled: true };
    if (page.extendedHistory) break;
  }
  return { page, nextCursor: cursor, cancelled: false };
}

/** A partial cached remainder must be completed through the remote cursor in
 * the same request. Otherwise the edge latch cannot move a full page away
 * from the threshold and history loading stalls before the server boundary. */
export function hasFullLocalOlderPage(
  residentMinimumOrdinal: number | null,
  persistedMinimumOrdinal: number | null,
): boolean {
  return residentMinimumOrdinal !== null
    && persistedMinimumOrdinal !== null
    && residentMinimumOrdinal - persistedMinimumOrdinal >= THREAD_HISTORY_PAGE_SIZE;
}

export function hasAnyLocalOlderTurn(
  residentMinimumOrdinal: number | null,
  persistedMinimumOrdinal: number | null,
): boolean {
  return residentMinimumOrdinal !== null
    && persistedMinimumOrdinal !== null
    && persistedMinimumOrdinal < residentMinimumOrdinal;
}

export function residentRangeForAnchor(
  anchorOrdinal: number | null,
  latestOrdinal: number | null,
): ResidentTurnRange {
  if (anchorOrdinal === null) return { maxOrdinal: null, turnLimit: THREAD_RESIDENT_TURN_LIMIT };
  const maxOrdinal = anchorOrdinal + THREAD_RESIDENT_RANGE_NEWER_BUFFER;
  if (latestOrdinal === null || maxOrdinal >= latestOrdinal) {
    return { maxOrdinal: null, turnLimit: THREAD_RESIDENT_TURN_LIMIT };
  }
  return {
    maxOrdinal,
    turnLimit: THREAD_RESIDENT_TURN_LIMIT,
  };
}

/** Freeze a live-tail range before new turns arrive while the reader is away. */
export function freezeResidentRange(latestOrdinal: number | null, visibleLiveOrdinals: readonly number[] = []): ResidentTurnBoundary {
  const boundary = visibleLiveOrdinals.reduce<number | null>(
    (current, ordinal) => current === null ? ordinal : Math.max(current, ordinal),
    latestOrdinal,
  );
  return boundary === null
    ? { maxOrdinal: null }
    : { maxOrdinal: boundary };
}

/** Cancels any in-flight older-page presentation and rejoins the live tail.
 * The request token owns stale completion suppression; this transition must
 * also clear its loading flag or every later pagination request stays blocked. */
export function revealResidentLiveTail(state: ThreadHistoryState): ThreadHistoryState {
  return {
    ...state,
    status: "ready",
    residentTurnLimit: THREAD_RESIDENT_TURN_LIMIT,
    residentMaxOrdinal: null,
    error: null,
  };
}

/** Recenter a bounded range around a stable visible turn. The trigger is
 * semantic (an ordinal derived from a turn id), never a recycled list index.
 * The returned range still contains the anchor, so MVCP can make eviction of
 * the opposite edge invisible. */
export function residentRangeForVisibleAnchor(
  state: Pick<ThreadHistoryState, "residentMaxOrdinal" | "residentTurnLimit">,
  anchorOrdinal: number,
  direction: ResidentRangeDirection,
  latestOrdinal: number | null,
  residentMinimumOrdinal: number | null,
  hasOlderHistory: boolean,
): ResidentTurnRange | null {
  const resolvedMax = state.residentMaxOrdinal ?? latestOrdinal;
  if (resolvedMax === null) return null;
  const currentLimit = THREAD_RESIDENT_TURN_LIMIT;
  const theoreticalMin = resolvedMax - currentLimit + 1;

  if (direction === "older") {
    if (!hasOlderHistory) return null;
    const enteredOlderEdge = anchorOrdinal <= theoreticalMin + THREAD_RESIDENT_RANGE_EDGE - 1
      || (residentMinimumOrdinal !== null && anchorOrdinal <= residentMinimumOrdinal);
    if (!enteredOlderEdge) return null;
    const maxOrdinal = latestOrdinal === null
      ? anchorOrdinal + THREAD_RESIDENT_RANGE_NEWER_BUFFER
      : Math.min(latestOrdinal, anchorOrdinal + THREAD_RESIDENT_RANGE_NEWER_BUFFER);
    return {
      maxOrdinal,
      turnLimit: THREAD_RESIDENT_TURN_LIMIT,
    };
  }

  if (state.residentMaxOrdinal == null || latestOrdinal === null) return null;
  const enteredNewerEdge = anchorOrdinal >= resolvedMax - THREAD_RESIDENT_RANGE_EDGE + 1;
  if (!enteredNewerEdge) return null;
  const maxOrdinal = Math.min(latestOrdinal, anchorOrdinal + THREAD_RESIDENT_RANGE_NEWER_BUFFER);
  return maxOrdinal >= latestOrdinal
    ? { maxOrdinal: null, turnLimit: THREAD_RESIDENT_TURN_LIMIT }
    : {
        maxOrdinal,
        turnLimit: THREAD_RESIDENT_TURN_LIMIT,
      };
}
