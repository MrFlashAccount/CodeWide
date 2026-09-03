import type { V2Item, V2TurnView } from "@codewide/sync-client/v2";

import type {
  LiveTurnPlanStepViewModel,
  LiveTurnPlanViewModel,
} from "../../presentation/usage/usageTypes";

type V2PlanItem = Extract<V2Item, { kind: "plan" }>;

/** Selects only a plan belonging to the current authoritative running turn. */
export function liveTurnPlanPresentation(
  turns: readonly V2TurnView[],
): LiveTurnPlanViewModel | null {
  const turn = latestRunningTurn(turns);
  if (turn === null) return null;
  const plan = latestPlan(turn.items);
  if (plan === null || plan.steps.length === 0) return null;
  const steps = plan.steps.map((step, index): LiveTurnPlanStepViewModel => ({
    id: `${plan.id}:${String(index)}`,
    state: step.status,
    text: step.text,
  }));
  const currentStep =
    steps.find((step) => step.state === "running") ??
    steps.find((step) => step.state === "pending") ??
    steps.at(-1);
  if (currentStep === undefined) return null;
  return {
    completedSteps: steps.filter((step) => step.state === "completed").length,
    currentStep,
    explanation: plan.text?.trim() === "" ? null : (plan.text ?? null),
    id: plan.id,
    steps,
  };
}

function latestRunningTurn(turns: readonly V2TurnView[]): V2TurnView | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn?.state === "running") return turn;
  }
  return null;
}

function latestPlan(items: readonly V2Item[]): V2PlanItem | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind === "plan") return item;
  }
  return null;
}
