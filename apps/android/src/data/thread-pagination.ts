export const THREAD_TURN_PAGE_SIZE = 6;
export const THREAD_HISTORY_PAGE_SIZE = 12;
// Only this many sealed turns may be materialized in Hermes at once. Older
// pages stay durable in SQLite and the live query moves over them as a window.
export const THREAD_RESIDENT_TURN_LIMIT = 180;
export const OLDER_PAGE_PREFETCH_FRACTION = 0.5;

export function shouldPrefetchOlderPage(firstVisibleIndex: number | null, scrollingTowardOlder: boolean): boolean {
  return scrollingTowardOlder
    && firstVisibleIndex !== null
    && firstVisibleIndex >= 0
    && firstVisibleIndex < THREAD_HISTORY_PAGE_SIZE * OLDER_PAGE_PREFETCH_FRACTION;
}

export function advanceResidentOffset(
  currentOffset: number,
  residentTurnCount: number,
  incomingTurnCount: number,
  limit = THREAD_RESIDENT_TURN_LIMIT,
): number {
  return currentOffset + Math.max(0, residentTurnCount + incomingTurnCount - limit);
}

export function retreatResidentOffset(currentOffset: number, pageSize = THREAD_HISTORY_PAGE_SIZE): number {
  return Math.max(0, currentOffset - pageSize);
}
