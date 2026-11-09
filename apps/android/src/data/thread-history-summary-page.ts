import type { Turn } from "@codewide/codex-protocol/v0.155.1/v2";

import { parseHistoryTurns } from "./thread-cursor-sync";
import { isThreadHistorySourceWitness } from "./thread-history-source-witness";

/** The Companion semantic history endpoints publish terminal message summaries. */
export type ThreadHistorySummaryPage = { hasMore: boolean; sourceWitness: string; turns: Turn[] };

const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["completed", "failed", "interrupted"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalidPage(reason: string): Error {
  return new Error(`Companion returned an invalid history summary page: ${reason}`);
}

/**
 * Validates page progress before semantic anchors or message rows reach SQLite.
 *
 * Turns and their items are read by `parseHistoryTurns`, the one turn parser
 * the thread snapshot, turn lists and search share, so a turn the snapshot
 * accepts is never refused on a later page. This adds only what paging and
 * storage rely on: the page bounds, its source witness, unique turns after
 * the anchor, and sealed (terminal) turns.
 */
export function parseThreadHistorySummaryPage(
  value: unknown,
  anchorTurnId: string,
  requestedLimit: number,
): ThreadHistorySummaryPage {
  if (!isRecord(value) || typeof value.hasMore !== "boolean") {
    throw invalidPage("not a page");
  }
  if (!isThreadHistorySourceWitness(value.sourceWitness)) {
    throw invalidPage("no source witness");
  }
  const turns = parseHistoryTurns(value.data);
  if (turns === null) {
    throw invalidPage("malformed turns");
  }
  if (turns.length > requestedLimit) {
    throw invalidPage("more turns than requested");
  }
  if (value.hasMore && turns.length === 0) {
    throw invalidPage("no progress");
  }
  const ids = new Set<string>([anchorTurnId]);
  for (const turn of turns) {
    if (turn.id.length === 0 || ids.has(turn.id)) {
      throw invalidPage("repeated turn");
    }
    if (!TERMINAL_STATUSES.has(turn.status)) {
      throw invalidPage("unsealed turn");
    }
    ids.add(turn.id);
  }
  return { hasMore: value.hasMore, sourceWitness: value.sourceWitness, turns };
}
