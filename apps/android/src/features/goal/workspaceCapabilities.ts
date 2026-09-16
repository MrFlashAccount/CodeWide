import type { ThreadGoal } from "@codewide/codex-protocol/v0.147.0/v2";
import type { ThreadGoalInput } from "../../data/workspace-resource-database";
/** Qualified goal operations; transport and persisted state stay with their existing lower owners. */
export type GoalWorkspaceCapabilities = {
  clearThreadGoal: (connectionId: string, threadId: string) => Promise<boolean>;
  getThreadGoal: (connectionId: string, threadId: string) => Promise<ThreadGoal | null>;
  setThreadGoal: (
    connectionId: string,
    threadId: string,
    input: ThreadGoalInput,
  ) => Promise<ThreadGoal>;
};
