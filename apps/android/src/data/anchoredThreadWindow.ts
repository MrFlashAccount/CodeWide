import type { ResolvedThreadDetailWindow } from "./thread-detail-sqlite.native";

/** An anchored open cannot use an unrelated cached tail as its initial transcript. */
export function windowContainsRequestedTurn(
  window: ResolvedThreadDetailWindow,
  turnId: string | null,
): boolean {
  if (turnId === null) {
    return true;
  }
  const matches = (row: ResolvedThreadDetailWindow["turnRows"][number]) =>
    row.kind === "turn" && row.remoteTurnId === turnId && row.turn !== null;
  return window.turnRows.some(matches) || window.liveRows.some(matches);
}

/** Seek a cold anchor using the durable older-page cursor, stopping at exhaustion or supersession. */
export async function resolveAnchoredThreadWindow(input: {
  readonly isCurrent: () => boolean;
  readonly loadOlder: (cursor: string, epoch: number) => Promise<void>;
  readonly read: () => Promise<ResolvedThreadDetailWindow>;
  readonly turnId: string | null;
}): Promise<ResolvedThreadDetailWindow> {
  let window = await input.read();
  if (input.turnId === null) {
    return window;
  }
  const visited = new Set<string>();
  while (input.isCurrent() && !windowContainsRequestedTurn(window, input.turnId)) {
    const cursor = window.liveRows.find((row) => row.kind === "thread")?.historyCursor;
    if (typeof cursor !== "string" || cursor === "" || visited.has(cursor)) {
      break;
    }
    visited.add(cursor);
    await input.loadOlder(cursor, window.historyEpoch);
    window = await input.read();
  }
  return window;
}
