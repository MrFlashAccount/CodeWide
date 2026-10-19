import type {
  ThreadSummaryDatabase,
  ThreadSummaryDatabaseOptions,
} from "./thread-summary-database-contract";

export type * from "./thread-summary-database-contract";

export function createThreadSummaryDatabase(
  _options: ThreadSummaryDatabaseOptions,
): ThreadSummaryDatabase {
  throw new Error("The persisted thread database is available in the Android build only");
}

export { threadSummaryKey } from "./thread-summary-projection";
