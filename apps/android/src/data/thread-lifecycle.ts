import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";

import { normalizePendingDeliveryState, type PendingDeliveryState } from "./thread-delivery-state";

export type ThreadLifecycleState = "running" | "approval" | "failed" | null | undefined;

export function isThreadLifecycleActive(state: ThreadLifecycleState): boolean {
  return state === "running" || state === "approval";
}

/**
 * A direct prompt owns the next turn before the live `turn/started` frame is
 * projected. Treat that handoff as active so a second normal send enters the
 * durable queue instead of racing another `turn/start` into the same turn.
 */
export function pendingDeliveryMayOwnTurn(state: PendingDeliveryState): boolean {
  return normalizePendingDeliveryState(state) !== "failed";
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
