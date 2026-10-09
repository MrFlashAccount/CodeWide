/**
 * `canUseTool` decision mapping.
 *
 * Builds honest approval requests and maps the user's response to a
 * permission decision. Fail-closed rules: a `decline`, `cancel`, `{type:
 * "error"}` or a malformed response always denies; `acceptForSession` only
 * ever grants for the session (the SDK adapter rewrites the suggested
 * updates to `destination: "session"`), so no settings file is written.
 * Pure; no I/O apart from path arithmetic.
 */

import { isAbsolute, relative } from "node:path";
import type {
  ApprovalKind,
  JsonValue,
  RuntimeRequest,
  RuntimeResponse,
  UserInputQuestion,
} from "../protocol.js";
import { asItemId } from "../protocol.js";
import { isRecord, type JsonRecord } from "../mapping/frames.js";
import { splitMcpToolName } from "../mapping/tools.js";
import { unreachable } from "../support/unreachable.js";

/** What `canUseTool` answers, in SDK-free terms. */
export type PermissionDecision =
  | {
      readonly behavior: "allow";
      /** `session` also applies the SDK's suggested permission updates for this session only. */
      readonly scope: "once" | "session";
      readonly toolUseID: string;
      readonly updatedInput: JsonRecord;
    }
  | {
      readonly behavior: "deny";
      readonly interrupt: boolean;
      readonly message: string;
      readonly toolUseID: string;
    };

export const DECLINE_MESSAGE = "User declined tool execution.";
export const CANCEL_MESSAGE = "User cancelled the turn.";
export const EXIT_PLAN_MESSAGE =
  "The user will review this plan. Stop here and wait for their reply.";
export const READ_ONLY_DENY_PREFIX = "The read-only permission profile does not allow";
export const readOnlyDenyMessage = (tool: string): string => `${READ_ONLY_DENY_PREFIX} ${tool}.`;

const FILE_EDIT_TOOLS: ReadonlySet<string> = new Set([
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Write",
]);

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

function displayPath(path: string, cwd: string): string {
  if (!isAbsolute(path)) {
    return path;
  }
  const relativePath = relative(cwd, path);
  return relativePath.length > 0 && !relativePath.startsWith("..") ? relativePath : path;
}

export function approvalKind(toolName: string): ApprovalKind {
  if (toolName === "Bash") {
    return "command";
  }
  return FILE_EDIT_TOOLS.has(toolName) ? "fileChange" : "tool";
}

/** Where a tool call runs, for its approval text. */
export interface ApprovalContext {
  readonly cwd: string;
  readonly mcpServers: readonly string[];
}

const pathTitle = (verb: string, input: JsonRecord, cwd: string): string => {
  const path = str(input["file_path"]) ?? str(input["notebook_path"]);
  return `${verb} ${path === null ? "a file" : displayPath(path, cwd)}`;
};

/** Titles of built-in tools, by tool name. */
const BUILT_IN_TITLES: Readonly<Record<string, (input: JsonRecord, cwd: string) => string>> = {
  Bash: (input) => `Run ${str(input["command"]) ?? "a command"}`,
  Edit: (input, cwd) => pathTitle("Edit", input, cwd),
  MultiEdit: (input, cwd) => pathTitle("Edit", input, cwd),
  NotebookEdit: (input, cwd) => pathTitle("Edit", input, cwd),
  Read: (input, cwd) => pathTitle("Read", input, cwd),
  WebFetch: (input) => `Fetch ${str(input["url"]) ?? "a web page"}`,
  WebSearch: (input) => `Search the web for ${str(input["query"]) ?? "a query"}`,
  Write: (input, cwd) => pathTitle("Write", input, cwd),
};

/** One-line description of exactly what the user approves. */
export function approvalTitle(
  toolName: string,
  input: JsonRecord,
  context: ApprovalContext,
): string {
  const builtIn = Object.hasOwn(BUILT_IN_TITLES, toolName) ? BUILT_IN_TITLES[toolName] : undefined;
  if (builtIn !== undefined) {
    return builtIn(input, context.cwd);
  }
  const mcp = splitMcpToolName(toolName, context.mcpServers);
  return mcp === null ? `Use ${toolName}` : `Use ${mcp.server} · ${mcp.tool}`;
}

/** The tool call an approval is asked for. */
export interface ApprovalSubject {
  readonly cwd: string;
  /** The SDK's reason for asking, shown as detail. */
  readonly detail: string | null;
  readonly input: JsonRecord;
  readonly mcpServers: readonly string[];
  readonly toolName: string;
  readonly toolUseId: string;
}

function commandLine(kind: ApprovalKind, input: JsonRecord, title: string): string | null {
  switch (kind) {
    case "command":
      return str(input["command"]);
    case "tool":
      return title;
    case "fileChange":
      return null;
    default:
      return unreachable(kind);
  }
}

export function approvalRequest(subject: ApprovalSubject): RuntimeRequest {
  const kind = approvalKind(subject.toolName);
  const title = approvalTitle(subject.toolName, subject.input, subject);
  return {
    command: commandLine(kind, subject.input, title),
    cwd: kind === "tool" ? null : subject.cwd,
    decisions: ["accept", "acceptForSession", "decline", "cancel"],
    detail: subject.detail,
    itemId: asItemId(subject.toolUseId),
    kind,
    title,
    type: "approval",
  };
}

/** Rewrites every suggested permission update to the session destination. */
export function sessionScoped<Update extends { readonly destination?: unknown }>(
  suggestions: readonly Update[],
): (Update & { readonly destination: "session" })[] {
  return suggestions.map((update) => ({ ...update, destination: "session" }));
}

const decline = (toolUseId: string): PermissionDecision => ({
  behavior: "deny",
  interrupt: false,
  message: DECLINE_MESSAGE,
  toolUseID: toolUseId,
});

export const cancelledDecision = (toolUseId: string): PermissionDecision => ({
  behavior: "deny",
  interrupt: true,
  message: CANCEL_MESSAGE,
  toolUseID: toolUseId,
});

/** The tool call a decision answers. */
export interface DecisionCall {
  readonly input: JsonRecord;
  readonly toolUseId: string;
}

/** Maps a user response on an approval to a permission decision. */
export function approvalDecision(
  response: RuntimeResponse,
  call: DecisionCall,
): PermissionDecision {
  if (response.type !== "approval") {
    return decline(call.toolUseId);
  }
  switch (response.decision) {
    case "accept":
    case "acceptForSession":
      return {
        behavior: "allow",
        scope: response.decision === "accept" ? "once" : "session",
        toolUseID: call.toolUseId,
        updatedInput: call.input,
      };
    case "decline":
      return decline(call.toolUseId);
    case "cancel":
      return cancelledDecision(call.toolUseId);
    default:
      return unreachable(response.decision);
  }
}

/** AskUserQuestion questions with ids `q<index>`. */
export function userInputQuestions(input: JsonRecord): readonly UserInputQuestion[] {
  const questions: readonly unknown[] = Array.isArray(input["questions"]) ? input["questions"] : [];
  return questions.flatMap((question, index) => {
    if (!isRecord(question)) {
      return [];
    }
    const options: readonly unknown[] = Array.isArray(question["options"])
      ? question["options"]
      : [];
    return [
      {
        allowOther: true,
        header: str(question["header"]) ?? "",
        id: `q${String(index)}`,
        multiSelect: question["multiSelect"] === true,
        options: options.flatMap((option) =>
          isRecord(option)
            ? [{ description: str(option["description"]) ?? "", label: str(option["label"]) ?? "" }]
            : [],
        ),
        question: str(question["question"]) ?? "",
        secret: false,
      },
    ];
  });
}

/**
 * Normalizes one answer. A comma-separated custom answer whose parts all
 * match option labels (case-insensitively) becomes those labels; anything
 * else is passed through as the user's own text.
 */
export function normalizeAnswer(question: UserInputQuestion, answers: readonly string[]): string {
  const joined = answers.join(", ");
  if (!question.multiSelect) {
    return joined;
  }
  const labels: string[] = [];
  for (const part of joined.split(",")) {
    const trimmed = part.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const label = question.options.find(
      (option) => option.label.toLowerCase() === trimmed.toLowerCase(),
    )?.label;
    if (label === undefined) {
      return joined;
    }
    labels.push(label);
  }
  return labels.length > 0 ? labels.join(", ") : joined;
}

/** Maps a user-input response to the SDK `updatedInput.answers` (question text → answer). */
export function userInputDecision(
  response: RuntimeResponse,
  call: DecisionCall & { readonly questions: readonly UserInputQuestion[] },
): PermissionDecision {
  if (response.type !== "userInput") {
    return decline(call.toolUseId);
  }
  const answers: Record<string, JsonValue> = {};
  for (const question of call.questions) {
    const answer = response.answers[question.id];
    if (answer !== undefined) {
      answers[question.question] = normalizeAnswer(question, answer.answers);
    }
  }
  return {
    behavior: "allow",
    scope: "once",
    toolUseID: call.toolUseId,
    updatedInput: { ...call.input, answers },
  };
}
