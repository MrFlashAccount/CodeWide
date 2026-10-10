/**
 * Classification of the messages Claude's session store returns
 * (`getSessionMessages` with system messages) into the few entry kinds the
 * history needs. Structural and total: anything unrecognized is skipped.
 * Pure; no I/O.
 *
 * - An assistant message, or a user message carrying `tool_result` blocks,
 *   is a frame for the turn builder (the same classification as live).
 * - A user message whose `origin` is not a person (`origin.kind` other than
 *   `human`: task notification, peer message) wakes the agent: it is never
 *   shown as a user message. A task notification also reports a sub-agent's
 *   final status. Interactive Claude Code stamps a person's prompts with
 *   `origin: {kind: "human"}`; SDK-driven sessions store them without one.
 * - `isQueuedCommand` marks a message Claude delivered while the agent was
 *   busy (queued prompt, notification): it belongs to the running turn.
 * - `[Request interrupted by user…]` ends the current turn as interrupted.
 * - The compact summary marks a compaction; the system message right before
 *   it is the compact boundary, whose uuid is the live compaction item id.
 * - Meta messages (`is_meta`: injected reminders, skill bodies) and
 *   command/markup echoes (`<command-name>`, `<local-command-stdout>`,
 *   `<system-reminder>`…) are hidden; every other top-level user message is
 *   a prompt, with its text and image blocks.
 * - Only messages of one conversation level are read: the main conversation
 *   (`parent_tool_use_id` null, as live) or one sub-agent transcript (its
 *   spawning tool call).
 */

import type { UserContent } from "../protocol.js";
import { classifyFrame, isRecord, type ClaudeFrame, type JsonRecord } from "../mapping/frames.js";
import { taskNotificationOf, type TaskNotification } from "../mapping/subagents.js";
import { HISTORY_HEADER } from "./prefix.js";

/** One classified stored message. */
export type HistoryEntry =
  | {
      readonly content: readonly UserContent[];
      readonly kind: "prompt";
      /** Delivered while the agent was busy: part of the running turn. */
      readonly queued: boolean;
      readonly timestampMs: number;
      readonly uuid: string;
    }
  | { readonly kind: "interrupt"; readonly timestampMs: number; readonly uuid: string }
  | {
      readonly kind: "wake";
      /** A task notification's facts, `null` for other wakes. */
      readonly notification: TaskNotification | null;
      /** Delivered while the agent was busy: part of the running turn. */
      readonly queued: boolean;
      readonly timestampMs: number;
      readonly uuid: string;
    }
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

/** `origin.kind` of a stored user message; `null` when it has no origin. */
function originKind(raw: JsonRecord): string | null {
  const origin = raw["origin"];
  if (!isRecord(origin)) {
    return null;
  }
  return str(origin["kind"]) ?? "unknown";
}

/** A message that wakes the agent without a person, or `null` for a person's message. */
function wakeEntry(message: StoredMessage, text: string): HistoryEntry | null {
  const origin = originKind(message.raw);
  if (origin === null || origin === "human") {
    return null;
  }
  return {
    kind: "wake",
    notification: origin === "task-notification" ? taskNotificationOf(text) : null,
    queued: message.raw["isQueuedCommand"] === true,
    timestampMs: message.timestampMs,
    uuid: message.uuid,
  };
}

function userEntry(message: StoredMessage): HistoryEntry | null {
  const { raw, timestampMs, uuid } = message;
  const body = isRecord(raw["message"]) ? raw["message"]["content"] : null;
  if (hasToolResult(body)) {
    return { frame: classifyFrame(raw), kind: "frame", timestampMs, uuid };
  }
  const content = userBlocks(body);
  const text = firstText(content);
  const wake = wakeEntry(message, text);
  if (wake !== null) {
    return wake;
  }
  if (INTERRUPT_MARKER.test(text)) {
    return { kind: "interrupt", timestampMs, uuid };
  }
  if (raw["is_meta"] === true || MARKUP.test(text)) {
    return null;
  }
  const prompt = withoutHistoryPrefix(content);
  const queued = raw["isQueuedCommand"] === true;
  return prompt.length === 0
    ? null
    : { content: prompt, kind: "prompt", queued, timestampMs, uuid };
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
