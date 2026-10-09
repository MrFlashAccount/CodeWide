/**
 * Classification of the messages Claude's session store returns
 * (`getSessionMessages` with system messages) into the few entry kinds the
 * history needs. Structural and total: anything unrecognized is skipped.
 * Pure; no I/O.
 *
 * - An assistant message, or a user message carrying `tool_result` blocks,
 *   is a frame for the turn builder (the same classification as live).
 * - A user message with an `origin` (task notification, peer message) wakes
 *   the agent without a person: it starts a provider turn and is not shown.
 * - `[Request interrupted by user…]` ends the current turn as interrupted.
 * - The compact summary marks a compaction; the system message right before
 *   it is the compact boundary, whose uuid is the live compaction item id.
 * - Meta messages and command/markup echoes are skipped; every other
 *   top-level user message is a prompt.
 * - Only messages of one conversation level are read: the main conversation
 *   (`parent_tool_use_id` null, as live) or one sub-agent transcript (its
 *   spawning tool call).
 */

import type { UserContent } from "../protocol.js";
import { classifyFrame, isRecord, type ClaudeFrame, type JsonRecord } from "../mapping/frames.js";
import { HISTORY_HEADER } from "./prefix.js";

/** One classified stored message. */
export type HistoryEntry =
  | {
      readonly content: readonly UserContent[];
      readonly kind: "prompt";
      readonly timestampMs: number;
      readonly uuid: string;
    }
  | { readonly kind: "interrupt"; readonly timestampMs: number; readonly uuid: string }
  | { readonly kind: "wake"; readonly timestampMs: number; readonly uuid: string }
  | { readonly kind: "compaction"; readonly timestampMs: number; readonly uuid: string }
  | {
      readonly frame: ClaudeFrame;
      readonly kind: "frame";
      readonly timestampMs: number;
      readonly uuid: string;
    };

const INTERRUPT_MARKER = /^\[Request interrupted by user[^\]]*\]/u;
/** Command echoes, local command output and injected reminders start with a tag. */
const MARKUP = /^\s*<[a-z][\w-]*[\s>]/u;

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** Text and image blocks of a stored user message. */
function userBlocks(content: unknown): readonly UserContent[] {
  if (typeof content === "string") {
    return [{ text: content, type: "text" }];
  }
  if (!Array.isArray(content)) {
    return [];
  }
  return content.flatMap((block: unknown): readonly UserContent[] => {
    if (!isRecord(block)) {
      return [];
    }
    if (block["type"] === "text") {
      return [{ text: str(block["text"]) ?? "", type: "text" }];
    }
    if (block["type"] === "image" && isRecord(block["source"])) {
      const source = block["source"];
      const mediaType = str(source["media_type"]) ?? "image/png";
      return [{ type: "image", url: `data:${mediaType};base64,${str(source["data"]) ?? ""}` }];
    }
    return [];
  });
}

const hasToolResult = (content: unknown): boolean =>
  Array.isArray(content) &&
  content.some((block: unknown) => isRecord(block) && block["type"] === "tool_result");

/** The prompt as the person wrote it: the lost-session history prefix block is dropped. */
const withoutHistoryPrefix = (content: readonly UserContent[]): readonly UserContent[] =>
  content.filter((block) => block.type !== "text" || !block.text.startsWith(HISTORY_HEADER));

function firstText(content: readonly UserContent[]): string {
  const first = content.find((block) => block.type === "text");
  return first?.type === "text" ? first.text : "";
}

interface StoredMessage {
  readonly raw: JsonRecord;
  readonly timestampMs: number;
  readonly uuid: string;
}

function userEntry(message: StoredMessage): HistoryEntry | null {
  const { raw, timestampMs, uuid } = message;
  const body = isRecord(raw["message"]) ? raw["message"]["content"] : null;
  if (hasToolResult(body)) {
    return { frame: classifyFrame(raw), kind: "frame", timestampMs, uuid };
  }
  if (isRecord(raw["origin"])) {
    return { kind: "wake", timestampMs, uuid };
  }
  const content = userBlocks(body);
  const text = firstText(content);
  if (INTERRUPT_MARKER.test(text)) {
    return { kind: "interrupt", timestampMs, uuid };
  }
  if (raw["is_meta"] === true || MARKUP.test(text)) {
    return null;
  }
  const prompt = withoutHistoryPrefix(content);
  return prompt.length === 0 ? null : { content: prompt, kind: "prompt", timestampMs, uuid };
}

function storedMessage(value: unknown, parentToolUseId: string | null): StoredMessage | null {
  if (!isRecord(value) || (value["parent_tool_use_id"] ?? null) !== parentToolUseId) {
    return null;
  }
  const uuid = str(value["uuid"]);
  const timestamp = str(value["timestamp"]);
  const timestampMs = timestamp === null ? Number.NaN : Date.parse(timestamp);
  return uuid === null || Number.isNaN(timestampMs) ? null : { raw: value, timestampMs, uuid };
}

/**
 * Classifies the messages of one conversation level, oldest first:
 * `parentToolUseId` is `null` for the main conversation, or the tool call
 * that spawned a sub-agent. `previousSystem` carries the uuid of a system
 * message directly before a compact summary.
 */
export function historyEntries(
  messages: readonly unknown[],
  parentToolUseId: string | null,
): readonly HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  let previousSystem: string | null = null;
  for (const value of messages) {
    const message = storedMessage(value, parentToolUseId);
    if (message === null) {
      continue;
    }
    const entry = classifyStored(message, previousSystem);
    previousSystem = message.raw["type"] === "system" ? message.uuid : null;
    if (entry !== null) {
      entries.push(entry);
    }
  }
  return entries;
}

function classifyStored(
  message: StoredMessage,
  previousSystem: string | null,
): HistoryEntry | null {
  const { raw, timestampMs, uuid } = message;
  if (raw["type"] === "assistant") {
    return { frame: classifyFrame(raw), kind: "frame", timestampMs, uuid };
  }
  if (raw["type"] !== "user") {
    return null;
  }
  if (raw["isCompactSummary"] === true) {
    return { kind: "compaction", timestampMs, uuid: previousSystem ?? uuid };
  }
  return userEntry(message);
}
