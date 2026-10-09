/**
 * Structural classification of raw Agent SDK messages.
 *
 * The SDK message union is wide and grows between CLI versions, and several
 * fields the sidecar relies on (`tool_result_meta`, `command_lifecycle`,
 * `origin`) are not declared in its types. This module reads every frame
 * structurally into a small discriminated union and never throws: anything
 * it does not understand becomes `{kind: "other"}`. Pure; no I/O.
 */

export type JsonRecord = Readonly<Record<string, unknown>>;

export const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const arr = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

/** One content block of an assistant message snapshot. */
export type AssistantBlock =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "thinking"; readonly text: string }
  | { readonly type: "toolUse"; readonly id: string; readonly name: string; readonly input: JsonRecord }
  | { readonly type: "other" };

export interface ToolResultBlock {
  readonly toolUseId: string;
  /** Text content joined from string or `{type:"text"}` blocks. */
  readonly text: string;
  /** Raw content blocks, kept for MCP results. */
  readonly blocks: readonly unknown[];
  readonly isError: boolean;
}

export interface UsageFigures {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
}

export type StreamEvent =
  | { readonly type: "messageStart"; readonly messageId: string }
  | { readonly type: "blockStart"; readonly index: number; readonly block: "text" | "thinking" | "toolUse" | "other" }
  | { readonly type: "textDelta"; readonly index: number; readonly text: string }
  | { readonly type: "thinkingDelta"; readonly index: number; readonly text: string }
  | { readonly type: "blockStop"; readonly index: number }
  | { readonly type: "other" };

export type ClaudeFrame =
  | { readonly kind: "init"; readonly mcpServers: readonly string[]; readonly sessionId: string | null }
  | { readonly kind: "stream"; readonly parentToolUseId: string | null; readonly event: StreamEvent }
  | {
      readonly kind: "assistant";
      readonly parentToolUseId: string | null;
      readonly messageId: string;
      readonly blocks: readonly AssistantBlock[];
      readonly error: string | null;
    }
  | {
      readonly kind: "user";
      readonly parentToolUseId: string | null;
      readonly isSynthetic: boolean;
      readonly toolResults: readonly ToolResultBlock[];
      readonly toolUseResult: unknown;
      /** `tool_result_meta[].non_execution_kind` by tool use id. */
      readonly nonExecution: ReadonlyMap<string, string>;
    }
  | {
      readonly kind: "result";
      readonly subtype: string;
      readonly isError: boolean;
      readonly terminalReason: string | null;
      readonly numTurns: number;
      readonly result: string | null;
      readonly errors: readonly string[];
      readonly userMessageUuids: readonly string[];
      /** `origin.kind` (e.g. `task-notification`, `peer`) or `null` for a user turn. */
      readonly origin: string | null;
      readonly usage: UsageFigures | null;
      readonly contextWindow: number | null;
    }
  | { readonly kind: "compactBoundary"; readonly uuid: string | null }
  | { readonly kind: "backgroundTasks"; readonly count: number }
  | { readonly kind: "rateLimit"; readonly status: string | null }
  | { readonly kind: "other"; readonly type: string };

function parseUsage(value: unknown): UsageFigures | null {
  if (!isRecord(value)) return null;
  const input = num(value["input_tokens"]) ?? 0;
  const cacheRead = num(value["cache_read_input_tokens"]) ?? 0;
  const cacheCreation = num(value["cache_creation_input_tokens"]) ?? 0;
  return {
    inputTokens: input + cacheRead + cacheCreation,
    cachedInputTokens: cacheRead,
    outputTokens: num(value["output_tokens"]) ?? 0,
  };
}

function contextWindowOf(modelUsage: unknown): number | null {
  if (!isRecord(modelUsage)) return null;
  let best: number | null = null;
  for (const entry of Object.values(modelUsage)) {
    const window = isRecord(entry) ? num(entry["contextWindow"]) : null;
    if (window !== null && (best === null || window > best)) best = window;
  }
  return best;
}

function parseAssistantBlock(value: unknown): AssistantBlock {
  if (!isRecord(value)) return { type: "other" };
  switch (value["type"]) {
    case "text":
      return { type: "text", text: str(value["text"]) ?? "" };
    case "thinking":
      return { type: "thinking", text: str(value["thinking"]) ?? "" };
    case "tool_use": {
      const id = str(value["id"]);
      const name = str(value["name"]);
      if (id === null || name === null) return { type: "other" };
      return { type: "toolUse", id, name, input: isRecord(value["input"]) ? value["input"] : {} };
    }
    default:
      return { type: "other" };
  }
}

/** Joins the text of a tool_result `content` (string or block list). */
export function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  return arr(content)
    .map((block) => (isRecord(block) && block["type"] === "text" ? (str(block["text"]) ?? "") : ""))
    .filter((text) => text.length > 0)
    .join("\n");
}

function parseStreamEvent(value: unknown): StreamEvent {
  if (!isRecord(value)) return { type: "other" };
  const index = num(value["index"]) ?? -1;
  switch (value["type"]) {
    case "message_start": {
      const message = value["message"];
      const messageId = isRecord(message) ? str(message["id"]) : null;
      return messageId === null ? { type: "other" } : { type: "messageStart", messageId };
    }
    case "content_block_start": {
      const block = value["content_block"];
      const blockType = isRecord(block) ? block["type"] : null;
      const kind = blockType === "text" ? "text" : blockType === "thinking" ? "thinking" : blockType === "tool_use" ? "toolUse" : "other";
      return { type: "blockStart", index, block: kind };
    }
    case "content_block_delta": {
      const delta = value["delta"];
      if (!isRecord(delta)) return { type: "other" };
      if (delta["type"] === "text_delta") return { type: "textDelta", index, text: str(delta["text"]) ?? "" };
      if (delta["type"] === "thinking_delta") return { type: "thinkingDelta", index, text: str(delta["thinking"]) ?? "" };
      return { type: "other" };
    }
    case "content_block_stop":
      return { type: "blockStop", index };
    default:
      return { type: "other" };
  }
}

/** Classifies one raw SDK message. Never throws. */
export function classifyFrame(value: unknown): ClaudeFrame {
  if (!isRecord(value)) return { kind: "other", type: "invalid" };
  const type = str(value["type"]) ?? "unknown";
  const parentToolUseId = str(value["parent_tool_use_id"]);
  switch (type) {
    case "system": {
      const subtype = str(value["subtype"]) ?? "";
      if (subtype === "init") {
        const servers = arr(value["mcp_servers"])
          .map((server) => (isRecord(server) ? str(server["name"]) : null))
          .filter((name): name is string => name !== null);
        return { kind: "init", mcpServers: servers, sessionId: str(value["session_id"]) };
      }
      if (subtype === "compact_boundary") return { kind: "compactBoundary", uuid: str(value["uuid"]) };
      if (subtype === "background_tasks_changed") return { kind: "backgroundTasks", count: arr(value["tasks"]).length };
      return { kind: "other", type: `system:${subtype}` };
    }
    case "stream_event":
      return { kind: "stream", parentToolUseId, event: parseStreamEvent(value["event"]) };
    case "assistant": {
      const message = value["message"];
      if (!isRecord(message)) return { kind: "other", type };
      const messageId = str(message["id"]) ?? str(value["uuid"]) ?? "message";
      return {
        kind: "assistant",
        parentToolUseId,
        messageId,
        blocks: arr(message["content"]).map(parseAssistantBlock),
        error: str(value["error"]),
      };
    }
    case "user": {
      const message = value["message"];
      const content = isRecord(message) ? message["content"] : null;
      const toolResults: ToolResultBlock[] = [];
      for (const block of arr(content)) {
        if (!isRecord(block) || block["type"] !== "tool_result") continue;
        const toolUseId = str(block["tool_use_id"]);
        if (toolUseId === null) continue;
        toolResults.push({
          toolUseId,
          text: toolResultText(block["content"]),
          blocks: typeof block["content"] === "string" ? [{ type: "text", text: block["content"] }] : arr(block["content"]),
          isError: block["is_error"] === true,
        });
      }
      const nonExecution = new Map<string, string>();
      for (const meta of arr(value["tool_result_meta"])) {
        if (!isRecord(meta)) continue;
        const id = str(meta["id"]);
        const kind = str(meta["non_execution_kind"]);
        if (id !== null && kind !== null) nonExecution.set(id, kind);
      }
      return {
        kind: "user",
        parentToolUseId,
        isSynthetic: value["isSynthetic"] === true,
        toolResults,
        toolUseResult: value["tool_use_result"],
        nonExecution,
      };
    }
    case "result": {
      const uuids = new Set<string>();
      const single = str(value["user_message_uuid"]);
      if (single !== null) uuids.add(single);
      for (const entry of arr(value["user_message_uuids"])) {
        const uuid = str(entry);
        if (uuid !== null) uuids.add(uuid);
      }
      const origin = value["origin"];
      return {
        kind: "result",
        subtype: str(value["subtype"]) ?? "unknown",
        isError: value["is_error"] === true,
        terminalReason: str(value["terminal_reason"]),
        numTurns: num(value["num_turns"]) ?? 0,
        result: str(value["result"]),
        errors: arr(value["errors"]).map(str).filter((entry): entry is string => entry !== null),
        userMessageUuids: [...uuids],
        origin: isRecord(origin) ? (str(origin["kind"]) ?? "unknown") : null,
        usage: parseUsage(value["usage"]),
        contextWindow: contextWindowOf(value["modelUsage"]),
      };
    }
    case "rate_limit_event": {
      const info = value["rate_limit_info"];
      return { kind: "rateLimit", status: isRecord(info) ? str(info["status"]) : null };
    }
    default:
      return { kind: "other", type };
  }
}
