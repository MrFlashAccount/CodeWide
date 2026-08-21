import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";

type Turn = Thread["turns"][number];

/**
 * Rejoins storage partitions in protocol chronology without letting lifecycle
 * state move a turn. The live value wins during the short live-to-sealed
 * handoff because it contains the newest streamed projection.
 */
export function mergeThreadPartitions(sealed: readonly Turn[], live: readonly Turn[]): Turn[] {
  const liveIds = new Set(live.map(({ id }) => id));
  const partitioned = [
    ...sealed.filter(({ id }) => !liveIds.has(id)),
    ...live,
  ];
  const originalIndex = new Map(partitioned.map((turn, index) => [turn, index] as const));
  partitioned.sort((left, right) => (
    compareProtocolTurnOrder(left, right)
      || (originalIndex.get(left) ?? 0) - (originalIndex.get(right) ?? 0)
  ));
  return deduplicateThreadTurns(partitioned);
}

/**
 * Projects sealed and live turns independently, then restores the order of the
 * already-merged protocol thread without recomputing static turn projections.
 */
export function mergeProjectedThreadPartitions<T extends { id: string }>(
  orderedTurns: readonly Pick<Turn, "id">[],
  sealed: readonly T[],
  live: readonly T[],
): T[] {
  const values = new Map<string, T>();
  for (const value of sealed) values.set(value.id, value);
  for (const value of live) values.set(value.id, value);
  return orderedTurns.flatMap(({ id }) => {
    const value = values.get(id);
    return value === undefined ? [] : [value];
  });
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

function compareProtocolTurnOrder(left: Turn, right: Turn): number {
  if (left.startedAt === null || right.startedAt === null || left.startedAt === right.startedAt) return 0;
  return left.startedAt - right.startedAt;
}
