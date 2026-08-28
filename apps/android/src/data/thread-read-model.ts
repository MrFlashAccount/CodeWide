import type { Thread, ThreadResumeResponse, Turn } from "@codewide/codex-protocol/v0.147.0/v2";
import { preserveProjectedTurnMetadata } from "@codewide/sync-client";

export const COMPANION_THREAD_READ_MODEL_VERSION = 1;

export type CompanionThreadResumeResponse = ThreadResumeResponse & {
  codewideReadModelVersion?: number;
};

export type CompanionThreadWindowResponse = CompanionThreadResumeResponse;

/**
 * Accepts the companion-owned chronological recovery window without touching
 * a stale client copy. Older read-model contracts are deliberately rejected:
 * normal navigation is journal-owned and recovery has one current protocol.
 */
export function materializeResumedThread(
  response: CompanionThreadResumeResponse,
): Thread {
  if (response.codewideReadModelVersion !== COMPANION_THREAD_READ_MODEL_VERSION) {
    throw new Error(`Unsupported companion thread read model: ${String(response.codewideReadModelVersion)}`);
  }
  const materializedIds = new Set(response.thread.turns.map(({ id }) => id));
  const missingPageTurn = response.initialTurnsPage?.data.find(({ id }) => !materializedIds.has(id));
  if (missingPageTurn !== undefined) {
    throw new Error(`Companion recovery window omitted turn ${missingPageTurn.id}`);
  }
  return response.thread;
}

export function materializeAuthoritativeThreadWindow(
  response: CompanionThreadWindowResponse,
  cached: Thread,
): Thread {
  const thread = materializeResumedThread(response);
  const authoritativeFullItems = new Map(
    thread.turns
      .filter(({ itemsView }) => itemsView === "full")
      .map(({ id, items }) => [id, items] as const),
  );
  const projected = preserveProjectedTurnMetadata(thread, cached);
  if (authoritativeFullItems.size === 0) return projected;
  return {
    ...projected,
    turns: projected.turns.map((turn) => {
      const items = authoritativeFullItems.get(turn.id);
      return items === undefined ? turn : { ...turn, items };
    }),
  };
}

export function materializeReadOnlyThreadWindow(
  shell: Thread,
  incomingTurns: Turn[],
  cached: Thread | null | undefined,
): Thread {
  const turns = new Map(shell.turns.map((turn) => [turn.id, turn] as const));
  for (const incoming of incomingTurns) {
    const current = turns.get(incoming.id);
    if (current?.status === "inProgress" && incoming.status === "inProgress") continue;
    const projected = preserveProjectedTurnMetadata(
      { ...shell, turns: [incoming] },
      current === undefined ? null : { ...shell, turns: [current] },
    );
    turns.set(incoming.id, projected.turns[0] ?? incoming);
  }
  return preserveProjectedTurnMetadata({
    ...shell,
    turns: [...turns.values()].sort((left, right) => (left.startedAt ?? 0) - (right.startedAt ?? 0)),
  }, cached);
}
