import type { BackgroundTaskOutputPage } from "../../data/backgroundTaskOutput";
import type { ThreadDetailDatabase } from "../../data/thread-detail-database";
import type { ThreadSummaryDatabase } from "../../data/thread-summary-database";
/** Qualified capabilities consumed by the agents owner in conversation composition. */
export type ConversationAgentCapabilities = {
  onOpenSubagentThread: ((threadId: string) => void) | undefined;
  /** One page of a thread's background task output, from byte `offset`. */
  onReadBackgroundTask:
    | ((threadId: string, taskId: string, offset: number) => Promise<BackgroundTaskOutputPage>)
    | undefined;
  onRefreshSubagents: ((rootThreadId: string) => Promise<void>) | undefined;
  subagentSummaryDatabase: ThreadSummaryDatabase | null;
  subagentThreadDetails: ThreadDetailDatabase | null;
};
