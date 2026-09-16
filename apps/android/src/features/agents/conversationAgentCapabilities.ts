import type { ThreadDetailDatabase } from "../../data/thread-detail-database";
import type { ThreadSummaryDatabase } from "../../data/thread-summary-database";
/** Qualified capabilities consumed by the agents owner in conversation composition. */
export type ConversationAgentCapabilities = {
  onOpenSubagentThread: ((threadId: string) => void) | undefined;
  onRefreshSubagents: ((rootThreadId: string) => Promise<void>) | undefined;
  subagentSummaryDatabase: ThreadSummaryDatabase | null;
  subagentThreadDetails: ThreadDetailDatabase | null;
};
