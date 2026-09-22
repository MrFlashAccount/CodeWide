import type { ThreadGoalStatus } from "@codewide/codex-protocol/v0.155.1/v2";

type GoalEditorValue = {
  objective: string;
  status: ThreadGoalStatus;
  tokenBudget: number | null;
};

export type GoalEditorValidation =
  | { error: null; value: GoalEditorValue }
  | { error: string; value: null };

export function validateGoalEditorDraft(
  objective: string,
  tokenBudget: string,
  status: ThreadGoalStatus = "active",
): GoalEditorValidation {
  const normalizedObjective = objective.trim();
  if (normalizedObjective === "") {
    return { error: "Goal objective is required", value: null };
  }

  const normalizedBudget = tokenBudget.trim();
  if (normalizedBudget === "") {
    return { error: null, value: { objective: normalizedObjective, status, tokenBudget: null } };
  }

  const budget = Number(normalizedBudget);
  if (!Number.isSafeInteger(budget) || budget < 1) {
    return { error: "Token budget must be a positive integer", value: null };
  }

  return { error: null, value: { objective: normalizedObjective, status, tokenBudget: budget } };
}
