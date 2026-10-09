import type { ThreadGoal } from "@codewide/codex-protocol/v0.155.1/v2";
import type { ThreadGoalInput } from "../../data/workspace-resource-database";
import type { useComposerGoalMode } from "./composerGoalMode";

type GoalSubmission = {
  readonly close: () => void;
  readonly submit: (objective: string) => Promise<void>;
};

/** Binds Send to goal text, without admitting a user turn or changing lifecycle intent. */
export function createComposerGoalSubmission(
  mode: ReturnType<typeof useComposerGoalMode>,
  currentGoal: ThreadGoal | null,
  setGoal: ((input: ThreadGoalInput) => Promise<ThreadGoal>) | undefined,
): GoalSubmission | null {
  if (!mode.goalAttachmentVisible || setGoal === undefined) {
    return null;
  }
  const goal = mode.editingGoal === null ? null : (currentGoal ?? mode.editingGoal);
  return {
    close: mode.captureGoalAttachment(),
    submit: async (objective: string): Promise<void> => {
      if (mode.editingGoal !== null && currentGoal === null) {
        throw new Error("This goal is no longer available to edit");
      }
      await setGoal(
        goal === null
          ? { objective, status: "active" }
          : { objective, status: goal.status, tokenBudget: goal.tokenBudget },
      );
    },
  };
}
