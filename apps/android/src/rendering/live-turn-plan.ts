import type { Thread, TurnPlanStep } from "@codewide/codex-protocol/v0.147.0/v2";
import { projectedTurnMetadata } from "@codewide/sync-client";

export type LiveTurnPlan = {
  explanation: string | null;
  steps: TurnPlanStep[];
};

export type LiveTurnPlanProgress = {
  completed: number;
  current: TurnPlanStep | null;
};

export function selectLiveTurnPlan(thread: Thread | null | undefined, turnId: string | null): LiveTurnPlan | null {
  if (thread === null || thread === undefined || turnId === null) return null;
  const turn = thread.turns.find((candidate) => candidate.id === turnId);
  if (turn === undefined || turn.status !== "inProgress") return null;
  const plan = projectedTurnMetadata(turn)?.plan;
  return plan === undefined || plan.steps.length === 0 ? null : plan;
}

export function liveTurnPlanProgress(plan: LiveTurnPlan): LiveTurnPlanProgress {
  return {
    completed: plan.steps.filter((step) => step.status === "completed").length,
    current: plan.steps.find((step) => step.status === "inProgress")
      ?? plan.steps.find((step) => step.status === "pending")
      ?? plan.steps.at(-1)
      ?? null,
  };
}
