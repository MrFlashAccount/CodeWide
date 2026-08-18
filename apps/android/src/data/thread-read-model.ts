import type { Thread, ThreadResumeResponse, Turn } from "@codewide/codex-protocol/v0.147.0/v2";
import { preserveProjectedTurnMetadata, seedThreadExecutionSettings } from "@codewide/sync-client";

export const COMPANION_THREAD_READ_MODEL_VERSION = 1;

export type CompanionThreadResumeResponse = ThreadResumeResponse & {
  codewideReadModelVersion?: number;
};

/**
 * Accepts the companion-owned chronological thread window without touching a
 * stale client copy. The compatibility branch is intentionally collocated and
 * can be deleted as soon as every supported companion emits read-model v1.
 */
export function materializeResumedThread(
  response: CompanionThreadResumeResponse,
  cached: Thread | null | undefined,
): Thread {
  if (response.codewideReadModelVersion === COMPANION_THREAD_READ_MODEL_VERSION) {
    const pageTurns = response.initialTurnsPage?.data ?? [];
    const materializedIds = new Set(response.thread.turns.map(({ id }) => id));
    // A companion read-model response is meant to be atomic, but older or
    // recovering companions could return a populated page beside an empty
    // thread shell. Never persist that contradiction as a successful empty
    // conversation: materialize the bounded page without merging stale cache.
    if (pageTurns.some(({ id }) => !materializedIds.has(id))) {
      return materializeLegacyThreadWindow(response.thread, pageTurns, null);
    }
    return response.thread;
  }
  const resumed = seedThreadExecutionSettings(response.thread, {
    model: response.model,
    effort: response.reasoningEffort,
    permissions: response.activePermissionProfile?.id ?? null,
    approvalPolicy: typeof response.approvalPolicy === "string" ? response.approvalPolicy : "granular",
    sandboxPolicy: response.sandbox.type,
  });
  return materializeLegacyThreadWindow(
    resumed,
    response.initialTurnsPage?.data ?? [],
    cached,
  );
}

export function materializeLegacyThreadWindow(
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
