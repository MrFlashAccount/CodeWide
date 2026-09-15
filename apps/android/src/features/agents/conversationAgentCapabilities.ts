import type { ThreadDetailDatabase } from "../../data/thread-detail-database";
import type { ThreadSummaryDatabase } from "../../data/thread-summary-database";
/** Qualified capabilities consumed by the agents owner in conversation composition. */
export type ConversationAgentCapabilities = {
  subagentSummaryDatabase: ThreadSummaryDatabase | null;
  subagentThreadDetails: ThreadDetailDatabase | null;
  onRefreshSubagents: ((rootThreadId: string) => Promise<void>) | undefined;
  onOpenSubagentThread: ((threadId: string) => void) | undefined;
};
