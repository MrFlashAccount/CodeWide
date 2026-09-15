import type { ThreadGoal } from "@codewide/codex-protocol/v0.147.0/v2";
import type { ThreadGoalInput } from "../../data/workspace-resource-database";
/** Qualified capabilities consumed by the goal owner in conversation composition. */
export type ConversationGoalCapabilities = {
  goalResourceId: string | null;
  onGetGoal: (() => Promise<ThreadGoal | null>) | undefined;
  onSetGoal: ((input: ThreadGoalInput) => Promise<ThreadGoal>) | undefined;
  onClearGoal: (() => Promise<boolean>) | undefined;
};
