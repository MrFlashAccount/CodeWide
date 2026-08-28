import type { Turn } from "@codewide/codex-protocol/v0.147.0/v2";

export type ThreadCursorPage = {
  data: Turn[];
  nextCursor: string | null;
};

export type ThreadCursorDelta = {
  /** Newer turns in chronological order, ready for append-only persistence. */
  turns: Turn[];
  /** Cursor used to continue from the newest page into older history. */
  historyCursor: string | null;
  /** False means the local cursor fell outside the canonical history chain. */
  anchorFound: boolean;
};

export type ThreadOpenSyncPlan = "local" | "cursor-catch-up" | "snapshot-import";

export function planThreadOpenSync(
  hasCachedThread: boolean,
  refreshCursor: number | null,
  forceRepair: boolean,
): ThreadOpenSyncPlan {
  if (!hasCachedThread) return "snapshot-import";
  // A forced repair is the ordered-journal integrity boundary. The caller may
  // satisfy it from the indexed terminal head when the resident thread and its
  // terminal witness are available; live or cold heads still require an App
  // Server snapshot. Both paths replace/repair the resident head atomically.
  if (forceRepair) return "snapshot-import";
  return refreshCursor !== null ? "cursor-catch-up" : "local";
}

export function threadOpenNeedsCursorCatchUp(
  plan: ThreadOpenSyncPlan,
  unresolvedDeliveredReceipt: boolean,
): boolean {
  return plan === "cursor-catch-up" || (plan === "local" && unresolvedDeliveredReceipt);
}

/**
 * A resident thread needs only a bounded authoritative head refresh that can
 * preserve its local metadata shell. A cold miss uses the companion-owned
 * indexed window read instead. Neither path resumes the App Server session;
 * mutation delivery owns lazy activation when a turn is actually started.
 */
export function shouldUseBoundedThreadWindowRead(hasCachedThread: boolean): boolean {
  return hasCachedThread;
}

/**
 * Reads the canonical tail until it reaches the last locally sealed turn.
 *
 * The server pages newest-first while SQLite stores turns oldest-first. The
 * local turn id is the stable semantic cursor: completed turns are immutable,
 * so every row before it is a missing append and the cursor row itself never
 * needs to be replaced. A null cursor is the first-import path and deliberately
 * reads one bounded tail page only.
 */
export async function collectThreadCursorDelta(
  afterTurnId: string | null,
  loadPage: (cursor: string | null) => Promise<ThreadCursorPage>,
  maxPages = 32,
): Promise<ThreadCursorDelta> {
  const collectedNewestFirst: Turn[] = [];
  const seenTurnIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let historyCursor: string | null = null;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const page = await loadPage(cursor);
    if (pageIndex === 0) historyCursor = page.nextCursor;
    const anchorIndex = afterTurnId === null
      ? -1
      : page.data.findIndex((turn) => turn.id === afterTurnId);
    // Include the anchor itself. A sparse completion can have the same stable
    // turn/item ids as the later authoritative final answer; excluding it
    // would make that final content impossible to reconcile.
    const candidates = anchorIndex < 0 ? page.data : page.data.slice(0, anchorIndex + 1);
    for (const turn of candidates) {
      if (seenTurnIds.has(turn.id)) continue;
      seenTurnIds.add(turn.id);
      collectedNewestFirst.push(turn);
    }

    if (afterTurnId === null || anchorIndex >= 0) {
      return {
        turns: collectedNewestFirst.reverse(),
        historyCursor,
        anchorFound: true,
      };
    }
    if (page.nextCursor === null) {
      return { turns: [], historyCursor, anchorFound: false };
    }
    if (seenCursors.has(page.nextCursor)) throw new Error("Server returned a repeated thread history cursor");
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }

  // The local cursor is older than the bounded catch-up budget. Let the caller
  // cross the explicit recovery boundary instead of turning a valid long-offline
  // thread into a permanent loading error.
  return { turns: [], historyCursor, anchorFound: false };
}

export function latestSealedTurnId(turns: readonly Turn[]): string | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn !== undefined && isStableThreadCursorTurn(turn)) return turn.id;
  }
  return null;
}

/**
 * A cursor is a promise that every earlier immutable row is complete. Failed
 * and interrupted turns are terminal by definition. A nominally completed turn
 * is safe from a live projection only after it contains an explicit final
 * answer. Authoritative history pages may seal unphased responses at
 * the storage boundary; an unwitnessed live completion must still be repaired.
 */
export function isStableThreadCursorTurn(turn: Turn): boolean {
  if (turn.status === "inProgress") return false;
  if (turn.status !== "completed") return true;
  return turn.items.some((item) => item.type === "agentMessage"
    && item.phase === "final_answer"
    && item.text.trim() !== "");
}
