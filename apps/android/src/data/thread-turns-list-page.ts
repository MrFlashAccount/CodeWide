import type { Turn } from "@codewide/codex-protocol/v0.155.1/v2";

import { parseHistoryTurns } from "./thread-cursor-sync";

export type ThreadTurnsListPage = {
  nextCursor: string | null;
  turns: Turn[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Validates one App Server history page before its cursor reaches SQLite. */
export function parseThreadTurnsListPage(
  value: unknown,
  requestedCursor: string | null,
): ThreadTurnsListPage {
  const response = isRecord(value) ? value : null;
  const turns = parseHistoryTurns(response?.data);
  const nextCursor = response?.nextCursor;
  if (
    response === null ||
    turns === null ||
    (nextCursor !== null && typeof nextCursor !== "string") ||
    nextCursor === "" ||
    (requestedCursor !== null && nextCursor === requestedCursor)
  ) {
    throw new Error("thread/turns/list returned an invalid history page");
  }
  return { nextCursor, turns };
}
