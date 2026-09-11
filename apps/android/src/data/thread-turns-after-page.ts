import type { Turn } from "@codewide/codex-protocol/v0.147.0/v2";

import { parseThreadHistorySummaryPage } from "./thread-history-summary-page";

export type ThreadTurnsAfterPage = {
  turns: Turn[];
  hasMore: boolean;
  sourceWitness: string;
};

/** Validates one Companion-owned forward page before it reaches SQLite. */
export function parseThreadTurnsAfterPage(value: unknown, afterTurnId: string, requestedLimit: number): ThreadTurnsAfterPage {
  return parseThreadHistorySummaryPage(value, afterTurnId, requestedLimit);
}
