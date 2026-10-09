import type { ThreadGoalStatus } from "@codewide/codex-protocol/v0.155.1/v2";

import type { GoalLifecycleCommands } from "./goalLifecycleCommands";

/** User-owned lifecycle intent; completion remains server-owned. */
export type GoalMenuAction = "pause" | "resume" | "stop";

type GoalTurnControl =
  | { readonly status: "idle" }
  | {
      readonly interrupt: (turnId: string) => Promise<void>;
      readonly status: "running";
      readonly turnId: string;
    };

/** Captured turn interruption or explicit absence of its required capability. */
export type GoalTurnCapture = GoalTurnControl | { readonly status: "unavailable" };

/** Validates the optional conversation boundary before admitting lifecycle work. */
export function captureGoalTurn(
  turnId: string | null,
  interrupt: ((turnId: string) => Promise<void>) | undefined,
): GoalTurnCapture {
  if (turnId === null) {
    return { status: "idle" };
  }
  if (interrupt === undefined) {
    return { status: "unavailable" };
  }
  return { interrupt, status: "running", turnId };
}

/** Pauses before interrupting and retains the goal until interruption succeeds. */
export async function performGoalMenuAction({
  action,
  capture,
  goalStatus,
  turn,
}: {
  readonly action: GoalMenuAction;
  readonly capture: () => GoalLifecycleCommands;
  readonly goalStatus: ThreadGoalStatus;
  readonly turn: GoalTurnControl;
}): Promise<void> {
  const commands = capture();
  if (action === "resume") {
    await commands.setStatus("active");
    return;
  }
  if (goalStatus === "active") {
    await commands.setStatus("paused");
  }
  if (turn.status === "running") {
    await turn.interrupt(turn.turnId);
  }
  if (action === "stop" && !(await commands.clear())) {
    throw new Error("Goal was already cleared");
  }
}
