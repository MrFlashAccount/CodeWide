/**
 * Structural classification of raw Agent SDK messages.
 *
 * The SDK message union is wide and grows between CLI versions, and several
 * fields the host relies on (`tool_result_meta`, `command_lifecycle`,
 * `origin`) are not declared in its types. This module reads every frame
 * structurally into a small discriminated union and never throws: anything
 * it does not understand becomes `{kind: "other"}`. Pure; no I/O.
 */

export type JsonRecord = Readonly<Record<string, unknown>>;

export const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const arr = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

/** One content block of an assistant message snapshot. */
export type AssistantBlock =
  | { readonly text: string; readonly type: "text" }
  | { readonly text: string; readonly type: "thinking" }
  | {
      readonly id: string;
      readonly input: JsonRecord;
      readonly name: string;
      readonly type: "toolUse";
    }
  | { readonly type: "other" };

export interface ToolResultBlock {
  /** Raw content blocks, kept for MCP results. */
  readonly blocks: readonly unknown[];
  readonly isError: boolean;
  /** Text content joined from string or `{type:"text"}` blocks. */
  readonly text: string;
  readonly toolUseId: string;
}

export interface UsageFigures {
  readonly cachedInputTokens: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export type StreamEvent =
  | { readonly messageId: string; readonly type: "messageStart" }
  | {
      readonly block: "text" | "thinking" | "toolUse" | "other";
      readonly index: number;
      readonly type: "blockStart";
    }
  | { readonly index: number; readonly text: string; readonly type: "textDelta" }
  | { readonly index: number; readonly text: string; readonly type: "thinkingDelta" }
  | { readonly index: number; readonly type: "blockStop" }
  | { readonly type: "other" };

export type ClaudeFrame =
  | {
      readonly kind: "init";
      readonly mcpServers: readonly string[];
      readonly sessionId: string | null;
    }
  | {
      readonly event: StreamEvent;
      readonly kind: "stream";
      readonly parentToolUseId: string | null;
    }
  | {
      readonly blocks: readonly AssistantBlock[];
      readonly error: string | null;
      readonly kind: "assistant";
      readonly messageId: string;
      readonly parentToolUseId: string | null;
      /** Uuid Claude persists the message under. */
      readonly uuid: string | null;
    }
  | {
      readonly isSynthetic: boolean;
      readonly kind: "user";
      /** `tool_result_meta[].non_execution_kind` by tool use id. */
      readonly nonExecution: ReadonlyMap<string, string>;
      readonly parentToolUseId: string | null;
      readonly toolResults: readonly ToolResultBlock[];
      readonly toolUseResult: unknown;
      /** Uuid Claude persists the message under. */
      readonly uuid: string | null;
    }
  | {
      readonly contextWindow: number | null;
      readonly errors: readonly string[];
      readonly isError: boolean;
      readonly kind: "result";
      readonly numTurns: number;
      /** `origin.kind` (e.g. `task-notification`, `peer`) or `null` for a user turn. */
      readonly origin: string | null;
      readonly result: string | null;
      readonly subtype: string;
      readonly terminalReason: string | null;
      readonly usage: UsageFigures | null;
      readonly userMessageUuids: readonly string[];
    }
  | { readonly kind: "compactBoundary"; readonly uuid: string | null }
  | { readonly count: number; readonly kind: "backgroundTasks" }
  | { readonly kind: "rateLimit"; readonly status: string | null }
  | { readonly kind: "other"; readonly type: string };

function parseUsage(value: unknown): UsageFigures | null {
  if (!isRecord(value)) {
    return null;
  }
  const input = num(value["input_tokens"]) ?? 0;
  const cacheRead = num(value["cache_read_input_tokens"]) ?? 0;
  const cacheCreation = num(value["cache_creation_input_tokens"]) ?? 0;
  return {
    cachedInputTokens: cacheRead,
    inputTokens: input + cacheRead + cacheCreation,
    outputTokens: num(value["output_tokens"]) ?? 0,
  };
}

function contextWindowOf(modelUsage: unknown): number | null {
  if (!isRecord(modelUsage)) {
    return null;
  }
  let best: number | null = null;
  for (const entry of Object.values(modelUsage)) {
    const window = isRecord(entry) ? num(entry["contextWindow"]) : null;
    if (window !== null && (best === null || window > best)) {
      best = window;
    }
  }
  return best;
}

function parseAssistantBlock(value: unknown): AssistantBlock {
  if (!isRecord(value)) {
    return { type: "other" };
  }
  switch (value["type"]) {
    case "text":
      return { text: str(value["text"]) ?? "", type: "text" };
    case "thinking":
      return { text: str(value["thinking"]) ?? "", type: "thinking" };
    case "tool_use": {
      const id = str(value["id"]);
      const name = str(value["name"]);
      if (id === null || name === null) {
        return { type: "other" };
      }
      return { id, input: isRecord(value["input"]) ? value["input"] : {}, name, type: "toolUse" };
    }
    default:
      return { type: "other" };
  }
}

/** Joins the text of a tool_result `content` (string or block list). */
export function toolResultText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  const texts: string[] = [];
  for (const block of arr(content)) {
    const text = isRecord(block) && block["type"] === "text" ? (str(block["text"]) ?? "") : "";
    if (text.length > 0) {
      texts.push(text);
    }
  }
  return texts.join("\n");
}

const OTHER_EVENT: StreamEvent = { type: "other" };
const NO_INDEX = -1;

const BLOCK_KINDS: Readonly<Record<string, "text" | "thinking" | "toolUse">> = {
  text: "text",
  thinking: "thinking",
  tool_use: "toolUse",
};

function blockKind(block: unknown): "text" | "thinking" | "toolUse" | "other" {
  const type = isRecord(block) ? str(block["type"]) : null;
  return type !== null && Object.hasOwn(BLOCK_KINDS, type)
    ? (BLOCK_KINDS[type] ?? "other")
    : "other";
}

function messageStart(event: JsonRecord): StreamEvent {
  const message = event["message"];
  const messageId = isRecord(message) ? str(message["id"]) : null;
  return messageId === null ? OTHER_EVENT : { messageId, type: "messageStart" };
}

function blockDelta(event: JsonRecord, index: number): StreamEvent {
  const delta = event["delta"];
  if (!isRecord(delta)) {
    return OTHER_EVENT;
  }
  if (delta["type"] === "text_delta") {
    return { index, text: str(delta["text"]) ?? "", type: "textDelta" };
  }
  if (delta["type"] === "thinking_delta") {
    return { index, text: str(delta["thinking"]) ?? "", type: "thinkingDelta" };
  }
  return OTHER_EVENT;
}

const STREAM_EVENTS: Readonly<Record<string, (event: JsonRecord, index: number) => StreamEvent>> = {
  content_block_delta: blockDelta,
  content_block_start: (event, index) => ({
    block: blockKind(event["content_block"]),
    index,
    type: "blockStart",
  }),
  content_block_stop: (_event, index) => ({ index, type: "blockStop" }),
  message_start: messageStart,
};

function parseStreamEvent(value: unknown): StreamEvent {
  const type = isRecord(value) ? str(value["type"]) : null;
  const parse =
    type !== null && Object.hasOwn(STREAM_EVENTS, type) ? STREAM_EVENTS[type] : undefined;
  return parse === undefined || !isRecord(value)
    ? OTHER_EVENT
    : parse(value, num(value["index"]) ?? NO_INDEX);
}

function systemFrame(value: JsonRecord): ClaudeFrame {
  const subtype = str(value["subtype"]) ?? "";
  switch (subtype) {
    case "init": {
      const servers: string[] = [];
      for (const server of arr(value["mcp_servers"])) {
        const name = isRecord(server) ? str(server["name"]) : null;
        if (name !== null) {
          servers.push(name);
        }
      }
      return { kind: "init", mcpServers: servers, sessionId: str(value["session_id"]) };
    }
    case "compact_boundary":
      return { kind: "compactBoundary", uuid: str(value["uuid"]) };
    case "background_tasks_changed":
      return { count: arr(value["tasks"]).length, kind: "backgroundTasks" };
    default:
      return { kind: "other", type: `system:${subtype}` };
  }
}

function assistantFrame(value: JsonRecord): ClaudeFrame {
  const message = value["message"];
  if (!isRecord(message)) {
    return { kind: "other", type: "assistant" };
  }
  return {
    blocks: arr(message["content"]).map(parseAssistantBlock),
    error: str(value["error"]),
    kind: "assistant",
    messageId: str(message["id"]) ?? str(value["uuid"]) ?? "message",
    parentToolUseId: str(value["parent_tool_use_id"]),
    uuid: str(value["uuid"]),
  };
}

function toolResult(block: unknown): ToolResultBlock | null {
  if (!isRecord(block) || block["type"] !== "tool_result") {
    return null;
  }
  const toolUseId = str(block["tool_use_id"]);
  if (toolUseId === null) {
    return null;
  }
  const content = block["content"];
  return {
    blocks: typeof content === "string" ? [{ text: content, type: "text" }] : arr(content),
    isError: block["is_error"] === true,
    text: toolResultText(content),
    toolUseId,
  };
}

function nonExecutionKinds(meta: unknown): ReadonlyMap<string, string> {
  const kinds = new Map<string, string>();
  for (const entry of arr(meta)) {
    const id = isRecord(entry) ? str(entry["id"]) : null;
    const kind = isRecord(entry) ? str(entry["non_execution_kind"]) : null;
    if (id !== null && kind !== null) {
      kinds.set(id, kind);
    }
  }
  return kinds;
}

function userFrame(value: JsonRecord): ClaudeFrame {
  const message = value["message"];
  const toolResults: ToolResultBlock[] = [];
  for (const block of arr(isRecord(message) ? message["content"] : null)) {
    const result = toolResult(block);
    if (result !== null) {
      toolResults.push(result);
    }
  }
  return {
    isSynthetic: value["isSynthetic"] === true,
    kind: "user",
    nonExecution: nonExecutionKinds(value["tool_result_meta"]),
    parentToolUseId: str(value["parent_tool_use_id"]),
    toolResults,
    toolUseResult: value["tool_use_result"],
    uuid: str(value["uuid"]),
  };
}

function strings(value: unknown): readonly string[] {
  const values: string[] = [];
  for (const entry of arr(value)) {
    const text = str(entry);
    if (text !== null) {
      values.push(text);
    }
  }
  return values;
}

function resultFrame(value: JsonRecord): ClaudeFrame {
  const single = str(value["user_message_uuid"]);
  const uuids = new Set([
    ...(single === null ? [] : [single]),
    ...strings(value["user_message_uuids"]),
  ]);
  const origin = value["origin"];
  return {
    contextWindow: contextWindowOf(value["modelUsage"]),
    errors: strings(value["errors"]),
    isError: value["is_error"] === true,
    kind: "result",
    numTurns: num(value["num_turns"]) ?? 0,
    origin: isRecord(origin) ? (str(origin["kind"]) ?? "unknown") : null,
    result: str(value["result"]),
    subtype: str(value["subtype"]) ?? "unknown",
    terminalReason: str(value["terminal_reason"]),
    usage: parseUsage(value["usage"]),
    userMessageUuids: [...uuids],
  };
}

function rateLimitFrame(value: JsonRecord): ClaudeFrame {
  const info = value["rate_limit_info"];
  return { kind: "rateLimit", status: isRecord(info) ? str(info["status"]) : null };
}

const FRAMES: Readonly<Record<string, (value: JsonRecord) => ClaudeFrame>> = {
  assistant: assistantFrame,
  rate_limit_event: rateLimitFrame,
  result: resultFrame,
  stream_event: (value) => ({
    event: parseStreamEvent(value["event"]),
    kind: "stream",
    parentToolUseId: str(value["parent_tool_use_id"]),
  }),
  system: systemFrame,
  user: userFrame,
};

/** Classifies one raw SDK message. Never throws. */
export function classifyFrame(value: unknown): ClaudeFrame {
  if (!isRecord(value)) {
    return { kind: "other", type: "invalid" };
  }
  const type = str(value["type"]) ?? "unknown";
  const classify = Object.hasOwn(FRAMES, type) ? FRAMES[type] : undefined;
  return classify === undefined ? { kind: "other", type } : classify(value);
}
