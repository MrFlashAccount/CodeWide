import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";

export type ThreadLifecycleState = "running" | "approval" | "failed" | null | undefined;

export type TurnLifecycleStatus = "completed" | "interrupted" | "failed" | "inProgress";

export function isThreadLifecycleActive(state: ThreadLifecycleState): boolean {
  return state === "running" || state === "approval";
}

/**
 * A loaded thread envelope and its mutable head must describe one lifecycle.
 * `notLoaded` is deliberately inconclusive; only an authoritative terminal
 * thread status is allowed to close a stale in-progress detail row locally.
 */
export function staleTurnLifecycleId(thread: Thread | null | undefined): string | null {
  if (thread === null || thread === undefined) return null;
  if (thread.status?.type !== "idle" && thread.status?.type !== "systemError") return null;
  for (let index = thread.turns.length - 1; index >= 0; index -= 1) {
    const turn = thread.turns[index];
    if (turn?.status === "inProgress") return turn.id;
  }
  return null;
}

/**
 * Presents the model atomically while the canonical cursor repair is in
 * flight. Callers also use this lifecycle to partition sealed and live turns.
 */
export function reconcileThreadLifecyclePresentation(thread: Thread): Thread {
  const staleTurnId = staleTurnLifecycleId(thread);
  if (staleTurnId === null) return thread;
  const terminalStatus: TurnLifecycleStatus = thread.status.type === "systemError" ? "failed" : "completed";
  return {
    ...thread,
    turns: thread.turns.map((turn) => turn.status === "inProgress"
      ? { ...turn, status: terminalStatus }
      : turn),
  };
}
