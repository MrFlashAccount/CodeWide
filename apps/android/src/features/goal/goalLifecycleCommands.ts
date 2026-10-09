import type { ThreadGoal } from "@codewide/codex-protocol/v0.155.1/v2";

/** Lifecycle commands captured for one connection and thread before an asynchronous action. */
export type GoalLifecycleCommands = {
  readonly clear: () => Promise<boolean>;
  readonly setStatus: (status: "active" | "paused") => Promise<ThreadGoal>;
};
