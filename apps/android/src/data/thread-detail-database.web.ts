import type { ThreadDetailDatabase } from "./thread-detail-database-contract";
export type * from "./thread-detail-database-contract";
export { materializePendingTimeline, materializeThreadDetails, materializeThreadTurns } from "./thread-detail-projection";
export type { PendingTimelineEntry, ThreadDetailRow, ThreadDetailSnapshot } from "./thread-detail-projection";

export function createThreadDetailDatabase(): ThreadDetailDatabase {
  throw new Error("Thread detail database is Android only");
}
