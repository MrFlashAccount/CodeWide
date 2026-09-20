import type { ThreadSummaryDatabase } from "./thread-summary-database-contract";
import type { GlobalSupervisorVisibilityPolicy } from "./globalSupervisorVisibility";
import type { GlobalSupervisorSummaryStoragePolicy } from "./globalSupervisorSummaryStoragePolicy";

export type * from "./thread-summary-database-contract";

export function createThreadSummaryDatabase(
  _options: {
    readonly globalSupervisorStorage?: GlobalSupervisorSummaryStoragePolicy;
    readonly visibility?: GlobalSupervisorVisibilityPolicy;
  } = {},
): ThreadSummaryDatabase {
  throw new Error("The persisted thread database is available in the Android build only");
}

export { threadSummaryKey } from "./thread-summary-projection";
