import type { ThreadGoalStatus } from "@codewide/codex-protocol/v0.147.0/v2";

export type GoalEditorValue = {
  objective: string;
  status: ThreadGoalStatus;
  tokenBudget: number | null;
};

export type GoalEditorValidation =
  | { value: GoalEditorValue; error: null }
  | { value: null; error: string };

export function validateGoalEditorDraft(
  objective: string,
  tokenBudget: string,
  status: ThreadGoalStatus = "active",
): GoalEditorValidation {
  const normalizedObjective = objective.trim();
  if (normalizedObjective === "") return { value: null, error: "Goal objective is required" };

  const normalizedBudget = tokenBudget.trim();
  if (normalizedBudget === "") {
    return { value: { objective: normalizedObjective, status, tokenBudget: null }, error: null };
  }

  const budget = Number(normalizedBudget);
  if (!Number.isSafeInteger(budget) || budget < 1) {
    return { value: null, error: "Token budget must be a positive integer" };
  }

  return { value: { objective: normalizedObjective, status, tokenBudget: budget }, error: null };
}
