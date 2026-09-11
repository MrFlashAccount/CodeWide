import type { Turn } from "@codewide/codex-protocol/v0.147.0/v2";
import { projectedTurnMetadata, type TurnUsageProjection } from "@codewide/sync-client";

/** A thread-level checkpoint, retained independently of the resident history page. */
export type ThreadCurrentUsage = {
  turnId: string;
  startedAt: number | null;
  usage: TurnUsageProjection;
};

/** Reads an authoritative tail, never a historical page. */
export function latestThreadUsage(turns: readonly Turn[]): ThreadCurrentUsage | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]!;
    const usage = projectedTurnMetadata(turn)?.usage;
    if (usage !== undefined) return { turnId: turn.id, startedAt: turn.startedAt, usage };
  }
  return null;
}

/** Live repair can include older turns; only the current or a newer turn advances usage. */
export function advanceThreadUsage(
  previous: ThreadCurrentUsage | null,
  turns: readonly Turn[],
): ThreadCurrentUsage | null {
  const next = latestThreadUsage(turns);
  if (next === null) return previous;
  if (previous === null || next.turnId === previous.turnId) return next;
  if (next.startedAt === null || previous.startedAt === null) return previous;
  return next.startedAt > previous.startedAt ? next : previous;
}
