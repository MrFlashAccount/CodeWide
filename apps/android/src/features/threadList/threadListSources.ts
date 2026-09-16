import type { AccountRateLimitsDatabase } from "../../data/account-rate-limits-database";
import type { PendingServerRequest } from "../../data/pending-request-types";
import type { ThreadSummaryDatabase } from "../../data/thread-summary-database";

/** Existing live read owners required by list presentation. */
export type ThreadListSources = {
  readonly accountRateLimitsDatabase: AccountRateLimitsDatabase | null;
  readonly pendingRequests: readonly PendingServerRequest[];
  readonly threadSummaryDatabase: ThreadSummaryDatabase | null;
};
