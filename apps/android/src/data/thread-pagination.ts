import type { ThreadLoadStatus } from "./thread-load-status";

export type ThreadHistoryState = {
  /** History generation whose remote cursor this state belongs to. */
  historyEpoch: number;
  status: ThreadLoadStatus;
  /**
   * `undefined` means a pre-cursor local cache whose server continuation has
   * not been resolved yet, `null` means the server proved that history is
   * complete, and a string is the next older server page.
   */
  nextCursor: string | null | undefined;
  error: string | null;
};

/** Small authoritative refresh used once a complete local window is available. */
export const THREAD_AUTHORITATIVE_TAIL_PAGE_SIZE = 6;
export const THREAD_HISTORY_PAGE_SIZE = 12;
// Keep the visible page plus one page of runway on either side. Edge pulls may
// temporarily exceed this limit during a gesture; the far edge is trimmed only
// after drag/momentum ends so MVCP never has to absorb an eviction under the
// user's finger.
export const THREAD_RESIDENT_TURN_LIMIT = THREAD_HISTORY_PAGE_SIZE * 3;

/** A cold or incomplete local window must arrive in one bounded response. The
 * six-turn tail is only a cheap freshness probe after SQLite already owns the
 * full local window; using it for bootstrap creates a visible multi-page
 * loading staircase. */
export function threadResumePageLimit(cachedTurnCount: number): number {
  return cachedTurnCount >= THREAD_RESIDENT_TURN_LIMIT
    ? THREAD_AUTHORITATIVE_TAIL_PAGE_SIZE
    : THREAD_RESIDENT_TURN_LIMIT;
}
