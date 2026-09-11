import type { Thread, Turn } from "@codewide/codex-protocol/v0.147.0/v2";

/** Latest turn outcome, independent of the resident history window. */
export type ThreadCurrentOutcome = {
  turnId: string;
  startedAt: number | null;
} & (
  | { status: "failed"; message: string }
  | { status: "inProgress" | "completed" | "interrupted" }
);

/** The caller supplies the authoritative tail, never a historical page. */
export function latestThreadOutcome(turns: readonly Turn[]): ThreadCurrentOutcome | null {
  const turn = turns.at(-1);
  if (turn === undefined) return null;
  return turnOutcome(turn);
}

function turnOutcome(turn: Turn): ThreadCurrentOutcome {
  return turn.status === "failed"
    ? { turnId: turn.id, startedAt: turn.startedAt, status: "failed", message: turn.error?.message || "The server could not complete this response." }
    : { turnId: turn.id, startedAt: turn.startedAt, status: turn.status };
}

/** Repairs of older live rows cannot replace the current turn's outcome. */
export function advanceThreadOutcome(
  previous: ThreadCurrentOutcome | null,
  turns: readonly Turn[],
  startedTurnId: string | null = null,
): ThreadCurrentOutcome | null {
  // An ordered turnStarted event proves the new head even when timestamps are
  // absent or two turns began in the same second. Use its final batch state.
  const started = startedTurnId === null ? undefined : turns.find((turn) => turn.id === startedTurnId);
  if (started !== undefined) return turnOutcome(started);
  const next = latestThreadOutcome(turns);
  if (next === null) return previous;
  if (previous === null || next.turnId === previous.turnId) return next;
  if (next.startedAt === null || previous.startedAt === null) return previous;
  return next.startedAt > previous.startedAt ? next : previous;
}

/** Presentation only: a failure notice never determines command admission. */
export function threadFailureNotice(
  outcome: ThreadCurrentOutcome | null,
  thread: Thread | null | undefined,
): { message: string; acceptsInput: boolean } | null {
  if (thread?.status.type === "active" || outcome?.status === "inProgress") return null;
  const message = outcome?.status === "failed" ? outcome.message
    : thread?.status.type === "systemError" ? "The server reported an error. Details are unavailable." : null;
  return message === null ? null : { message, acceptsInput: thread?.canAcceptDirectInput === true };
}
