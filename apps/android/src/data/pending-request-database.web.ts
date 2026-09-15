import type { PendingRequestDatabase } from "./pending-request-database-contract";

export type * from "./pending-request-database-contract";

export function createPendingRequestDatabase(): PendingRequestDatabase {
  throw new Error("Pending request database is Android only");
}
