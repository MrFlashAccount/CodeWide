/** V1 GoalFeature owner, extracted without changing interaction or resource lifetime. */
import type { ThreadGoal } from "@codewide/codex-protocol/v0.147.0/v2";
import type { ThreadGoalInput } from "../../data/workspace-resource-database";

/** Goal editor state and actions supplied by its owning feature. */
export type GoalDialogProps = {
  visible: boolean;
  onClose(): void;
  goal: ThreadGoal | null;
  resourceError: string | null;
  onSet(input: ThreadGoalInput): Promise<ThreadGoal>;
  onClear(): Promise<boolean>;
  voiceScope: string;
};
