/**
 * Pure mapping of Claude tool calls to neutral items.
 *
 * `startItem` builds the in-progress item from a `tool_use` input (so the
 * client sees the command or diff before any approval), `completeItem` builds
 * the final item from the matching `tool_result` and the structured
 * `tool_use_result`. Tools without a dedicated neutral item become
 * `toolCall {namespace: "claude"}`. Pure; no I/O.
 */

import type { AgentItem, ExecutionStatus, FileChange, ItemId, JsonValue } from "../protocol.js";
import { asItemId } from "../protocol.js";
import { isRecord, type JsonRecord, type ToolResultBlock } from "./frames.js";

/** Bash output kept on the item: the last 1 MiB. */
export const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;
/** Text output kept on generic tool calls. */
export const MAX_TOOL_OUTPUT_BYTES = 1024 * 1024;

export const READ_ONLY_TOOLS: readonly string[] = ["Read", "Glob", "Grep", "LS"];
const FILE_EDIT_TOOLS: readonly string[] = ["Edit", "Write", "MultiEdit", "NotebookEdit"];
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
  if (name === "TodoWrite") return { type: "plan" };
  if (name === "AskUserQuestion") return { type: "question" };
  if (name === "ExitPlanMode") return { type: "exitPlan" };
  return { type: "item" };
}

/** Keeps the last `limit` bytes of `text` with a leading truncation line. */
export function keepTail(text: string, limit: number): string {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= limit) return text;
  const buffer = Buffer.from(text, "utf8");
  let start = bytes - limit;
  // Do not start inside a UTF-8 continuation byte.
  while (start < bytes && ((buffer[start] ?? 0) & 0xc0) === 0x80) start += 1;
  return `[output truncated: first ${start} bytes omitted]\n${buffer.subarray(start).toString("utf8")}`;
}

/** Splits `mcp__<server>__<tool>` using the longest known server name. */
export function splitMcpToolName(
  name: string,
  knownServers: readonly string[],
): { readonly server: string; readonly tool: string } | null {
  if (!name.startsWith("mcp__")) return null;
  const rest = name.slice("mcp__".length);
  const normalize = (server: string): string => server.replace(/[^A-Za-z0-9_-]/g, "_");
  const candidates = [...knownServers].sort((left, right) => right.length - left.length);
  for (const server of candidates) {
    const prefix = `${normalize(server)}__`;
    if (rest.startsWith(prefix)) return { server, tool: rest.slice(prefix.length) };
  }
  const separator = rest.indexOf("__");
  if (separator <= 0) return null;
  const rawServer = rest.slice(0, separator);
  const server = rawServer.startsWith("claude_ai_") ? `claude.ai ${rawServer.slice("claude_ai_".length).replace(/_/g, " ")}` : rawServer;
  return { server, tool: rest.slice(separator + 2) };
}

function asJson(value: JsonRecord): JsonValue {
  // WHY: SDK tool inputs are parsed JSON objects from the CLI's stdout, so
  // every value is a JSON value by construction.
  return value as JsonValue;
}

function lines(prefix: "-" | "+", text: string): string {
  if (text.length === 0) return "";
  return `${text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n")}\n`;
}

function inputDiff(name: string, input: JsonRecord): readonly FileChange[] {
  const path = str(input["file_path"]) ?? str(input["notebook_path"]) ?? "";
  if (name === "Write") {
    return [{ path, kind: "add", movePath: null, diff: str(input["content"]) ?? "" }];
  }
  if (name === "MultiEdit") {
    const edits = Array.isArray(input["edits"]) ? input["edits"] : [];
    const diff = edits
      .map((edit) =>
        isRecord(edit) ? lines("-", str(edit["old_string"]) ?? "") + lines("+", str(edit["new_string"]) ?? "") : "",
      )
      .join("");
    return [{ path, kind: "update", movePath: null, diff }];
  }
  if (name === "NotebookEdit") {
    return [{ path, kind: "update", movePath: null, diff: lines("+", str(input["new_source"]) ?? "") }];
  }
  return [
    {
      path,
      kind: "update",
      movePath: null,
      diff: lines("-", str(input["old_string"]) ?? "") + lines("+", str(input["new_string"]) ?? ""),
    },
  ];
}

interface PatchHunk {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly string[];
}

function parseHunks(value: unknown): readonly PatchHunk[] {
  if (!Array.isArray(value)) return [];
  const hunks: PatchHunk[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const numbers = [entry["oldStart"], entry["oldLines"], entry["newStart"], entry["newLines"]];
    if (!numbers.every((number) => typeof number === "number")) continue;
    const hunkLines = Array.isArray(entry["lines"]) ? entry["lines"].filter((line): line is string => typeof line === "string") : [];
    hunks.push({
      // WHY: the four values were checked to be numbers on the line above.
      oldStart: numbers[0] as number,
      oldLines: numbers[1] as number,
      newStart: numbers[2] as number,
      newLines: numbers[3] as number,
      lines: hunkLines,
    });
  }
  return hunks;
}

/** Renders structuredPatch hunks as a unified diff body. */
export function renderHunks(hunks: readonly PatchHunk[]): string {
  return hunks
    .map(
      (hunk) =>
        `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n${hunk.lines.map((line) => `${line}\n`).join("")}`,
    )
    .join("");
}

function completedDiff(name: string, input: JsonRecord, toolUseResult: unknown): readonly FileChange[] {
  const fallback = inputDiff(name, input);
  if (!isRecord(toolUseResult)) return fallback;
  const path = str(toolUseResult["filePath"]) ?? fallback[0]?.path ?? "";
  if (name === "Write" && toolUseResult["type"] === "create") {
    return [{ path, kind: "add", movePath: null, diff: str(toolUseResult["content"]) ?? str(input["content"]) ?? "" }];
  }
  const hunks = parseHunks(toolUseResult["structuredPatch"]);
  if (hunks.length > 0) return [{ path, kind: "update", movePath: null, diff: renderHunks(hunks) }];
  if (name === "Write") {
    const original = str(toolUseResult["originalFile"]) ?? "";
    const content = str(toolUseResult["content"]) ?? "";
    return [{ path, kind: "update", movePath: null, diff: lines("-", original) + lines("+", content) }];
  }
  return fallback.map((change) => ({ ...change, path }));
}

/** Context the mapping needs from the session. */
export interface ToolContext {
  readonly cwd: string;
  readonly mcpServers: readonly string[];
}

/** In-progress item for a tool call, or `null` for tools without an item. */
export function startItem(id: string, name: string, input: JsonRecord, context: ToolContext): AgentItem | null {
  if (toolDisposition(name).type !== "item") return null;
  const itemId = asItemId(id);
  if (name === "Bash") {
    return {
      type: "command",
      itemId,
      command: str(input["command"]) ?? "",
      cwd: context.cwd,
      status: "inProgress",
      output: null,
      exitCode: null,
      durationMs: null,
    };
  }
  if (FILE_EDIT_TOOLS.includes(name)) {
    return { type: "fileChange", itemId, changes: inputDiff(name, input), status: "inProgress" };
  }
  if (name === "WebSearch") {
    const query = str(input["query"]) ?? "";
    return { type: "webSearch", itemId, query, action: { type: "search", query } };
  }
  if (name === "WebFetch") {
    return { type: "webSearch", itemId, query: "", action: { type: "openPage", url: str(input["url"]) ?? "" } };
  }
  const mcp = splitMcpToolName(name, context.mcpServers);
  if (mcp !== null) {
    return {
      type: "mcpToolCall",
      itemId,
      server: mcp.server,
      tool: mcp.tool,
      arguments: asJson(input),
      status: "inProgress",
      result: null,
      error: null,
      durationMs: null,
    };
  }
  return {
    type: "toolCall",
    itemId,
    namespace: "claude",
    tool: name,
    arguments: asJson(input),
    output: null,
    status: "inProgress",
    durationMs: null,
  };
}

/** Image views that accompany a completed `Read` of an image file. */
export function imageViewFor(id: string, name: string, input: JsonRecord): AgentItem | null {
  const path = str(input["file_path"]);
  if (name !== "Read" || path === null || !IMAGE_EXTENSION.test(path)) return null;
  return { type: "imageView", itemId: asItemId(`${id}:image`), path };
}

/** How a tool call ended, from the result block and the user's decision. */
export function executionStatus(
  result: ToolResultBlock,
  nonExecution: string | undefined,
  declinedByUser: boolean,
): ExecutionStatus {
  if (declinedByUser || nonExecution === "permission-rule") return "declined";
  if (nonExecution === "cancelled" || result.isError) return "failed";
  return "completed";
}

function bashOutput(result: ToolResultBlock, toolUseResult: unknown): string {
  if (isRecord(toolUseResult)) {
    const parts = [str(toolUseResult["stdout"]), str(toolUseResult["stderr"])].filter(
      (part): part is string => part !== null && part.length > 0,
    );
    if (parts.length > 0) return parts.join(parts[0]?.endsWith("\n") === true ? "" : "\n");
  }
  return result.text;
}

/** Final item for a started tool call and its result. */
export function completeItem(
  started: AgentItem,
  name: string,
  input: JsonRecord,
  result: ToolResultBlock,
  toolUseResult: unknown,
  status: ExecutionStatus,
  durationMs: number,
): AgentItem {
  const callStatus = status === "completed" ? "completed" : "failed";
  switch (started.type) {
    case "command":
      return {
        ...started,
        status,
        output: keepTail(bashOutput(result, toolUseResult), MAX_COMMAND_OUTPUT_BYTES),
        exitCode: status === "completed" ? 0 : null,
        durationMs,
      };
    case "fileChange":
      return {
        ...started,
        status,
        changes: status === "completed" ? completedDiff(name, input, toolUseResult) : started.changes,
      };
    case "mcpToolCall":
      return {
        ...started,
        status: callStatus,
        result:
          callStatus === "completed"
            ? {
                // WHY: tool_result content blocks are parsed JSON from the CLI.
                content: result.blocks as readonly JsonValue[],
                structuredContent: null,
              }
            : null,
        error: callStatus === "completed" ? null : result.text,
        durationMs,
      };
    case "toolCall":
      return {
        ...started,
        status: callStatus,
        output: keepTail(result.text, MAX_TOOL_OUTPUT_BYTES),
        durationMs,
      };
    default:
      return started;
  }
}

/** Closes an item that never received its result (interrupt, exit). */
export function failOpenItem(item: AgentItem): AgentItem {
  switch (item.type) {
    case "command":
    case "fileChange":
      return { ...item, status: "failed" };
    case "mcpToolCall":
    case "toolCall":
      return { ...item, status: "failed" };
    default:
      return item;
  }
}

/** Plan steps from a TodoWrite input. */
export function todoPlan(
  input: JsonRecord,
): readonly { readonly step: string; readonly status: "pending" | "inProgress" | "completed" }[] {
  const todos = Array.isArray(input["todos"]) ? input["todos"] : [];
  return todos.flatMap((todo) => {
    if (!isRecord(todo)) return [];
    const step = str(todo["content"]) ?? str(todo["activeForm"]) ?? "";
    const raw = str(todo["status"]);
    const status = raw === "completed" ? "completed" : raw === "in_progress" ? "inProgress" : "pending";
    return [{ step, status }];
  });
}

/** Item id helper for non-tool items. */
export const blockItemId = (messageId: string, blockIndex: number): ItemId => asItemId(`${messageId}:${blockIndex}`);
