import type { ThreadGoalStatus } from "@codewide/codex-protocol/v0.155.1/v2";

export type GoalLifecycleAction =
  | {
      readonly kind: "pause";
      readonly label: "Pause goal";
      readonly pendingLabel: "Pausing…";
      readonly status: "paused";
    }
  | {
      readonly kind: "resume";
      readonly label: "Resume goal";
      readonly pendingLabel: "Resuming…";
      readonly status: "active";
    };

/** User-owned lifecycle transition available for the authoritative goal status. */
export function goalLifecycleAction(status: ThreadGoalStatus): GoalLifecycleAction | null {
  switch (status) {
    case "active":
      return {
        kind: "pause",
        label: "Pause goal",
        pendingLabel: "Pausing…",
        status: "paused",
      };
    case "blocked":
    case "paused":
      return {
        kind: "resume",
        label: "Resume goal",
        pendingLabel: "Resuming…",
        status: "active",
      };
    case "budgetLimited":
    case "complete":
    case "usageLimited":
      return null;
    default:
      throw new Error("Unsupported goal status");
  }
}

export function threadGoalStatusLabel(status: ThreadGoalStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "paused":
      return "Paused";
    case "blocked":
      return "Blocked";
    case "usageLimited":
      return "Usage limited";
    case "budgetLimited":
      return "Budget limited";
    case "complete":
      return "Complete";
    default:
      throw new Error("Unsupported goal status");
  }
}
