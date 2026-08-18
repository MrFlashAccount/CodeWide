export type ThreadLifecycleState = "running" | "approval" | "failed" | null | undefined;

export type TurnLifecycleStatus = "completed" | "interrupted" | "failed" | "inProgress";

export function isThreadLifecycleActive(state: ThreadLifecycleState): boolean {
  return state === "running" || state === "approval";
}

/**
 * The thread summary owns lifecycle state. Detail rows own immutable content,
 * but can temporarily retain a stale in-progress status when a terminal event
 * was missed or its projection failed. Never keep presenting a terminal thread
 * as live while the authoritative detail snapshot repairs that mismatch.
 */
export function effectiveTurnLifecycleStatus(
  status: TurnLifecycleStatus,
  threadState: ThreadLifecycleState,
): TurnLifecycleStatus {
  if (status !== "inProgress" || isThreadLifecycleActive(threadState)) return status;
  return threadState === "failed" ? "failed" : "completed";
}
