/**
 * Pure mapping of Claude tool calls to neutral items.
 *
 * `startItem` builds the in-progress item from a `tool_use` input (so the
 * client sees the command or diff before any approval), `completeItem` builds
 * the final item from the matching `tool_result` and the structured
 * `tool_use_result`. Tools without a dedicated neutral item become
 * `toolCall {namespace: "claude"}`; the companion's client tools become
 * `toolCall {namespace: null}` with their bare name. Pure; no I/O.
 */

import type { AgentItem, ExecutionStatus, ItemId } from "../protocol.js";
import { asItemId } from "../protocol.js";
import { clientToolOf } from "./clientTools.js";
import { completedDiff, inputDiff } from "./diffs.js";
import { isRecord, type JsonRecord, type ToolResultBlock } from "./frames.js";
import { toJsonValue } from "./json.js";
import { unreachable } from "../support/unreachable.js";

const BYTES_PER_KIB = 1024;
const MIB = BYTES_PER_KIB * BYTES_PER_KIB;
/** Bash output kept on the item: the last 1 MiB. */
export const MAX_COMMAND_OUTPUT_BYTES = MIB;
/** Text output kept on generic tool calls. */
export const MAX_TOOL_OUTPUT_BYTES = MIB;
const UTF8_CONTINUATION_MASK = 0b1100_0000;
const UTF8_CONTINUATION = 0b1000_0000;
const MCP_PREFIX = "mcp__";
const MCP_SEPARATOR = "__";
const CLAUDE_AI_PREFIX = "claude_ai_";

export const READ_ONLY_TOOLS: readonly string[] = ["Read", "Glob", "Grep", "LS"];
const FILE_EDIT_TOOLS: ReadonlySet<string> = new Set([
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
]);
const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|bmp)$/i;

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** What a tool call becomes in the neutral model. */
export type ToolDisposition =
  | { readonly type: "item" }
  /** TodoWrite: a `plan.updated` event, no item. */
  | { readonly type: "plan" }
  /** AskUserQuestion: a user-input request, no item. */
  | { readonly type: "question" }
  /** ExitPlanMode: a `plan` item, then the call is denied. */
  | { readonly type: "exitPlan" };

export function toolDisposition(name: string): ToolDisposition {
  if (name === "TodoWrite") {
    return { type: "plan" };
  }
  if (name === "AskUserQuestion") {
    return { type: "question" };
  }
  if (name === "ExitPlanMode") {
    return { type: "exitPlan" };
  }
  return { type: "item" };
}

/** Keeps the last `limit` bytes of `text` with a leading truncation line. */
export function keepTail(text: string, limit: number): string {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= limit) {
    return text;
  }
  const buffer = Buffer.from(text, "utf8");
  let start = bytes - limit;
  // Do not start inside a UTF-8 continuation byte.
  while (start < bytes && ((buffer[start] ?? 0) & UTF8_CONTINUATION_MASK) === UTF8_CONTINUATION) {
    start += 1;
  }
  return `[output truncated: first ${String(start)} bytes omitted]\n${buffer.subarray(start).toString("utf8")}`;
}

const normalizeServer = (server: string): string => server.replaceAll(/[^A-Za-z0-9_-]/gu, "_");

/** Display name of a server name taken from the tool name itself. */
const displayServer = (raw: string): string =>
  raw.startsWith(CLAUDE_AI_PREFIX)
    ? `claude.ai ${raw.slice(CLAUDE_AI_PREFIX.length).replaceAll("_", " ")}`
    : raw;

/** Splits `mcp__<server>__<tool>` using the longest known server name. */
export function splitMcpToolName(
  name: string,
  knownServers: readonly string[],
): { readonly server: string; readonly tool: string } | null {
  if (!name.startsWith(MCP_PREFIX)) {
    return null;
  }
  const rest = name.slice(MCP_PREFIX.length);
  const candidates = knownServers.toSorted((left, right) => right.length - left.length);
  for (const server of candidates) {
    const prefix = `${normalizeServer(server)}${MCP_SEPARATOR}`;
    if (rest.startsWith(prefix)) {
      return { server, tool: rest.slice(prefix.length) };
    }
  }
  const separator = rest.indexOf(MCP_SEPARATOR);
  if (separator <= 0) {
    return null;
  }
  return {
    server: displayServer(rest.slice(0, separator)),
    tool: rest.slice(separator + MCP_SEPARATOR.length),
  };
}

/** Context the mapping needs from the session. */
export interface ToolContext {
  readonly cwd: string;
  readonly mcpServers: readonly string[];
}

/** A tool call as the model issued it. */
export interface ToolCallInput {
  readonly id: string;
  readonly input: JsonRecord;
  readonly name: string;
}

function webItem(call: ToolCallInput): AgentItem | null {
  const itemId = asItemId(call.id);
  if (call.name === "WebSearch") {
    const query = str(call.input["query"]) ?? "";
    return { action: { query, type: "search" }, itemId, query, type: "webSearch" };
  }
  if (call.name === "WebFetch") {
    const url = str(call.input["url"]) ?? "";
    return { action: { type: "openPage", url }, itemId, query: "", type: "webSearch" };
  }
  return null;
}

function callItem(call: ToolCallInput, context: ToolContext): AgentItem {
  const itemId = asItemId(call.id);
  const args = toJsonValue(call.input);
  const clientTool = clientToolOf(call.name);
  if (clientTool !== null) {
    return {
      arguments: args,
      durationMs: null,
      itemId,
      namespace: null,
      output: null,
      status: "inProgress",
      tool: clientTool,
      type: "toolCall",
    };
  }
  const mcp = splitMcpToolName(call.name, context.mcpServers);
  if (mcp !== null) {
    return {
      arguments: args,
      durationMs: null,
      error: null,
      itemId,
      result: null,
      server: mcp.server,
      status: "inProgress",
      tool: mcp.tool,
      type: "mcpToolCall",
    };
  }
  return {
    arguments: args,
    durationMs: null,
    itemId,
    namespace: "claude",
    output: null,
    status: "inProgress",
    tool: call.name,
    type: "toolCall",
  };
}

/** In-progress item for a tool call, or `null` for tools without an item. */
export function startItem(call: ToolCallInput, context: ToolContext): AgentItem | null {
  if (toolDisposition(call.name).type !== "item") {
    return null;
  }
  const itemId = asItemId(call.id);
  if (call.name === "Bash") {
    return {
      command: str(call.input["command"]) ?? "",
      cwd: context.cwd,
      durationMs: null,
      exitCode: null,
      itemId,
      output: null,
      status: "inProgress",
      type: "command",
    };
  }
  if (FILE_EDIT_TOOLS.has(call.name)) {
    return {
      changes: inputDiff(call.name, call.input),
      itemId,
      status: "inProgress",
      type: "fileChange",
    };
  }
  return webItem(call) ?? callItem(call, context);
}

/** Image views that accompany a completed `Read` of an image file. */
export function imageViewFor(id: string, name: string, input: JsonRecord): AgentItem | null {
  const path = str(input["file_path"]);
  if (name !== "Read" || path === null || !IMAGE_EXTENSION.test(path)) {
    return null;
  }
  return { itemId: asItemId(`${id}:image`), path, type: "imageView" };
}

/** How a tool call ended, from the result block and the user's decision. */
export function executionStatus(
  result: ToolResultBlock,
  nonExecution: string | undefined,
  declinedByUser: boolean,
): ExecutionStatus {
  if (declinedByUser || nonExecution === "permission-rule") {
    return "declined";
  }
  if (nonExecution === "cancelled" || result.isError) {
    return "failed";
  }
  return "completed";
}

function bashOutput(result: ToolResultBlock, toolUseResult: unknown): string {
  if (isRecord(toolUseResult)) {
    const parts = [str(toolUseResult["stdout"]), str(toolUseResult["stderr"])].filter(
      (part): part is string => part !== null && part.length > 0,
    );
    if (parts.length > 0) {
      return parts.join(parts[0]?.endsWith("\n") === true ? "" : "\n");
    }
  }
  return result.text;
}

/** How a started tool call ended. */
export interface ToolOutcome {
  readonly durationMs: number;
  readonly result: ToolResultBlock;
  readonly status: ExecutionStatus;
  /** The SDK's structured `tool_use_result`, when the live stream carried it. */
  readonly toolUseResult: unknown;
}

type ToolItem = Extract<
  AgentItem,
  { readonly type: "command" | "fileChange" | "mcpToolCall" | "toolCall" }
>;

const isToolItem = (item: AgentItem): item is ToolItem =>
  item.type === "command" ||
  item.type === "fileChange" ||
  item.type === "mcpToolCall" ||
  item.type === "toolCall";

function completeCall(
  started: Extract<AgentItem, { readonly type: "mcpToolCall" | "toolCall" }>,
  outcome: ToolOutcome,
): AgentItem {
  const completed = outcome.status === "completed";
  const status = completed ? "completed" : "failed";
  if (started.type === "toolCall") {
    return {
      ...started,
      durationMs: outcome.durationMs,
      output: keepTail(outcome.result.text, MAX_TOOL_OUTPUT_BYTES),
      status,
    };
  }
  return {
    ...started,
    durationMs: outcome.durationMs,
    error: completed ? null : outcome.result.text,
    result: completed
      ? { content: outcome.result.blocks.map(toJsonValue), structuredContent: null }
      : null,
    status,
  };
}

function completeToolItem(started: ToolItem, call: ToolCallInput, outcome: ToolOutcome): AgentItem {
  switch (started.type) {
    case "command":
      return {
        ...started,
        durationMs: outcome.durationMs,
        exitCode: outcome.status === "completed" ? 0 : null,
        output: keepTail(
          bashOutput(outcome.result, outcome.toolUseResult),
          MAX_COMMAND_OUTPUT_BYTES,
        ),
        status: outcome.status,
      };
    case "fileChange":
      return {
        ...started,
        changes:
          outcome.status === "completed"
            ? completedDiff(call.name, call.input, outcome.toolUseResult)
            : started.changes,
        status: outcome.status,
      };
    case "mcpToolCall":
    case "toolCall":
      return completeCall(started, outcome);
    default:
      return unreachable(started);
  }
}

/** Final item for a started tool call and its result; other items are returned unchanged. */
export function completeItem(
  started: AgentItem,
  call: ToolCallInput,
  outcome: ToolOutcome,
): AgentItem {
  return isToolItem(started) ? completeToolItem(started, call, outcome) : started;
}

/** Closes an item that never received its result (interrupt, exit). */
export function failOpenItem(item: AgentItem): AgentItem {
  return isToolItem(item) ? { ...item, status: "failed" } : item;
}

function todoStatus(raw: string | null): "pending" | "inProgress" | "completed" {
  if (raw === "completed") {
    return "completed";
  }
  return raw === "in_progress" ? "inProgress" : "pending";
}

/** Plan steps from a TodoWrite input. */
export function todoPlan(
  input: JsonRecord,
): readonly { readonly status: "pending" | "inProgress" | "completed"; readonly step: string }[] {
  const todos: readonly unknown[] = Array.isArray(input["todos"]) ? input["todos"] : [];
  return todos.flatMap((todo) => {
    if (!isRecord(todo)) {
      return [];
    }
    const step = str(todo["content"]) ?? str(todo["activeForm"]) ?? "";
    return [{ status: todoStatus(str(todo["status"])), step }];
  });
}

/** Item id helper for non-tool items. */
export const blockItemId = (messageId: string, blockIndex: number): ItemId =>
  asItemId(`${messageId}:${String(blockIndex)}`);
