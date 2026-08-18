import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";

type Turn = Thread["turns"][number];

/**
 * Joins the immutable history and mutable head without exposing the same turn
 * twice during the short live-to-sealed handoff. The live value wins because
 * it contains the newest streamed projection.
 */
export function mergeThreadPartitions(sealed: readonly Turn[], live: readonly Turn[]): Turn[] {
  const liveIds = new Set(live.map(({ id }) => id));
  return deduplicateThreadTurns([
    ...sealed.filter(({ id }) => !liveIds.has(id)),
    ...live,
  ]);
}

/**
 * Collapses transport retries of one command without conflating intentional
 * repeated prompts. A client message id is generated once per send and reused
 * only while reconciling an interrupted delivery.
 */
export function deduplicateThreadTurns(turns: readonly Turn[]): Turn[] {
  const result: Turn[] = [];
  const indexByClientId = new Map<string, number>();
  for (const turn of turns) {
    const clientId = turn.items.find((item) => item.type === "userMessage")?.clientId;
    if (clientId === null || clientId === undefined || clientId === "") {
      result.push(turn);
      continue;
    }
    const previousIndex = indexByClientId.get(clientId);
    if (previousIndex === undefined) {
      indexByClientId.set(clientId, result.length);
      result.push(turn);
      continue;
    }
    const previous = result[previousIndex]!;
    if (previous.status === "inProgress" && turn.status !== "inProgress") result[previousIndex] = turn;
  }
  return result;
}
