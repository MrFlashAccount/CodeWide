import type { ThreadGoal, ThreadGoalStatus } from "@codewide/codex-protocol/v0.155.1/v2";
import type { ThreadGoalInput } from "../../data/workspace-resource-database";
import type { GoalLifecycleCommands } from "./goalLifecycleCommands";
/** Qualified capabilities consumed by the goal owner in conversation composition. */
export type ConversationGoalCapabilities = {
  captureGoalLifecycle: (() => GoalLifecycleCommands) | undefined;
  goalResourceId: string | null;
  onClearGoal: (() => Promise<boolean>) | undefined;
  onGetGoal: (() => Promise<ThreadGoal | null>) | undefined;
  onSetGoal: ((input: ThreadGoalInput) => Promise<ThreadGoal>) | undefined;
  onSetGoalStatus: ((status: ThreadGoalStatus) => Promise<ThreadGoal>) | undefined;
};
