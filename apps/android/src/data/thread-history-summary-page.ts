import type { Turn } from "@codewide/codex-protocol/v0.147.0/v2";

import { parseHistoryTurns } from "./thread-cursor-sync";
import { isThreadHistorySourceWitness } from "./thread-history-source-witness";

/** The Companion semantic history endpoints publish terminal message summaries. */
export type ThreadHistorySummaryPage = { turns: Turn[]; hasMore: boolean; sourceWitness: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isOptionalTime(value: unknown): boolean {
  return (
    value === undefined || value === null || (typeof value === "number" && Number.isFinite(value))
  );
}

function isUserInput(value: unknown): boolean {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case "text":
      return (
        typeof value.text === "string" &&
        Array.isArray(value.text_elements) &&
        value.text_elements.every(
          (element: unknown) =>
            isRecord(element) &&
            isRecord(element.byteRange) &&
            Number.isSafeInteger(element.byteRange.start) &&
            Number.isSafeInteger(element.byteRange.end) &&
            (element.placeholder === null || typeof element.placeholder === "string"),
        )
      );
    case "image":
    case "audio":
      return typeof value.url === "string";
    case "localImage":
    case "localAudio":
      return typeof value.path === "string";
    case "skill":
    case "mention":
      return typeof value.name === "string" && typeof value.path === "string";
    default:
      return false;
  }
}

function isSummaryItem(value: unknown): boolean {
  if (!isRecord(value) || !isId(value.id)) return false;
  switch (value.type) {
    case "userMessage":
      return (
        (value.clientId === undefined || value.clientId === null || isId(value.clientId)) &&
        Array.isArray(value.content) &&
        value.content.every(isUserInput)
      );
    case "agentMessage":
      return (
        typeof value.text === "string" &&
        (value.phase === undefined ||
          value.phase === null ||
          value.phase === "commentary" ||
          value.phase === "final_answer") &&
        (value.memoryCitation === undefined || value.memoryCitation === null)
      );
    default:
      return false;
  }
}

function isSummaryTurn(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !isId(value.id) ||
    (value.status !== "completed" && value.status !== "failed" && value.status !== "interrupted") ||
    !isOptionalTime(value.startedAt) ||
    !isOptionalTime(value.completedAt) ||
    !isOptionalTime(value.durationMs) ||
    (value.error !== undefined &&
      value.error !== null &&
      (!isRecord(value.error) || typeof value.error.message !== "string"))
  )
    return false;
  if (value.items === undefined) {
    // Bounded projections may externalize a whole turn. Retain its canonical
    // identity and let the existing Conversation adapter mark content unloaded.
    const content = isRecord(value.codewideContent) ? value.codewideContent : null;
    const whole = isRecord(content?.whole) ? content.whole : null;
    return (
      content?.version === 1 &&
      whole !== null &&
      typeof whole.id === "string" &&
      /^[a-f0-9]{64}$/u.test(whole.id) &&
      typeof whole.byteLength === "number" &&
      Number.isSafeInteger(whole.byteLength) &&
      whole.byteLength >= 0 &&
      typeof whole.contentType === "string"
    );
  }
  if (!Array.isArray(value.items) || !value.items.every(isSummaryItem)) return false;
  const ids = new Set<string>();
  for (const item of value.items) {
    if (!isRecord(item) || !isId(item.id) || ids.has(item.id)) return false;
    ids.add(item.id);
  }
  return (
    value.itemsView === undefined ||
    value.itemsView === "summary" ||
    value.itemsView === "notLoaded"
  );
}

/** Validates page progress before semantic anchors or message rows reach SQLite. */
export function parseThreadHistorySummaryPage(
  value: unknown,
  anchorTurnId: string,
  requestedLimit: number,
): ThreadHistorySummaryPage {
  if (
    !isRecord(value) ||
    !Array.isArray(value.data) ||
    typeof value.hasMore !== "boolean" ||
    !isThreadHistorySourceWitness(value.sourceWitness) ||
    value.data.length > requestedLimit ||
    (value.hasMore && value.data.length === 0) ||
    !value.data.every(isSummaryTurn)
  )
    throw new Error("Companion returned an invalid history summary page");
  const ids = new Set<string>([anchorTurnId]);
  for (const turn of value.data) {
    if (!isRecord(turn) || !isId(turn.id) || ids.has(turn.id)) {
      throw new Error("Companion returned an invalid history summary page");
    }
    ids.add(turn.id);
  }
  const turns = parseHistoryTurns(value.data);
  if (turns === null) throw new Error("Companion returned an invalid history summary page");
  return { turns, hasMore: value.hasMore, sourceWitness: value.sourceWitness };
}
