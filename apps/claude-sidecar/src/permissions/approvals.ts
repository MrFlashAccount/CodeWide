/**
 * `canUseTool` decision mapping.
 *
 * Builds honest approval requests and maps the user's response to an SDK
 * permission result. Fail-closed rules: a `decline`, `cancel`, `{type:
 * "error"}` or a malformed response always denies; `acceptForSession` only
 * ever produces `destination: "session"` updates, so no settings file is
 * written. Pure; no I/O.
 */

import { relative, isAbsolute } from "node:path";
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

/** Structural mirror of the SDK `PermissionUpdate` (only the fields we rewrite). */
export type PermissionUpdateLike = JsonRecord & { readonly destination?: unknown };

/** Structural mirror of the SDK `PermissionResult`. */
export type PermissionDecision =
  | {
      readonly behavior: "allow";
      readonly updatedInput: JsonRecord;
      readonly updatedPermissions: readonly PermissionUpdateLike[] | null;
      readonly toolUseID: string;
    }
  | {
      readonly behavior: "deny";
      readonly message: string;
      readonly interrupt: boolean;
      readonly toolUseID: string;
    };

export const DECLINE_MESSAGE = "User declined tool execution.";
export const CANCEL_MESSAGE = "User cancelled the turn.";
export const EXIT_PLAN_MESSAGE = "The user will review this plan. Stop here and wait for their reply.";
export const readOnlyDenyMessage = (tool: string): string => `The read-only permission profile does not allow ${tool}.`;

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

function displayPath(path: string, cwd: string): string {
  if (!isAbsolute(path)) return path;
  const relativePath = relative(cwd, path);
  return relativePath.length > 0 && !relativePath.startsWith("..") ? relativePath : path;
}

export function approvalKind(toolName: string): ApprovalKind {
  if (toolName === "Bash") return "command";
  if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(toolName)) return "fileChange";
  return "tool";
}

/** One-line description of exactly what the user approves. */
export function approvalTitle(toolName: string, input: JsonRecord, cwd: string, mcpServers: readonly string[]): string {
  const path = str(input["file_path"]) ?? str(input["notebook_path"]);
  switch (toolName) {
    case "Bash":
      return `Run ${str(input["command"]) ?? "a command"}`;
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return `Edit ${path === null ? "a file" : displayPath(path, cwd)}`;
    case "Write":
      return `Write ${path === null ? "a file" : displayPath(path, cwd)}`;
    case "WebFetch":
      return `Fetch ${str(input["url"]) ?? "a web page"}`;
    case "WebSearch":
      return `Search the web for ${str(input["query"]) ?? "a query"}`;
    case "Read":
      return `Read ${path === null ? "a file" : displayPath(path, cwd)}`;
    default: {
      const mcp = splitMcpToolName(toolName, mcpServers);
      if (mcp !== null) return `Use ${mcp.server} · ${mcp.tool}`;
      return `Use ${toolName}`;
    }
  }
}

export function approvalRequest(
  toolName: string,
  toolUseId: string,
  input: JsonRecord,
  cwd: string,
  mcpServers: readonly string[],
  detail: string | null,
): RuntimeRequest {
  const kind = approvalKind(toolName);
  return {
    type: "approval",
    kind,
    itemId: asItemId(toolUseId),
    title: approvalTitle(toolName, input, cwd, mcpServers),
    detail,
    command: kind === "command" ? (str(input["command"]) ?? null) : kind === "tool" ? approvalTitle(toolName, input, cwd, mcpServers) : null,
    cwd: kind === "tool" ? null : cwd,
    decisions: ["accept", "acceptForSession", "decline", "cancel"],
  };
}

/** Rewrites every suggested update to the session destination. */
export function sessionScopedUpdates(suggestions: readonly unknown[]): readonly PermissionUpdateLike[] {
  return suggestions.filter(isRecord).map((update) => ({ ...update, destination: "session" }));
}

/** Maps a user response on an approval to the SDK permission result. */
export function approvalDecision(
  response: RuntimeResponse,
  input: JsonRecord,
  suggestions: readonly unknown[],
  toolUseId: string,
): PermissionDecision {
  if (response.type === "approval") {
    switch (response.decision) {
      case "accept":
        return { behavior: "allow", updatedInput: input, updatedPermissions: null, toolUseID: toolUseId };
      case "acceptForSession":
        return {
          behavior: "allow",
          updatedInput: input,
          updatedPermissions: sessionScopedUpdates(suggestions),
          toolUseID: toolUseId,
        };
      case "decline":
        return { behavior: "deny", message: DECLINE_MESSAGE, interrupt: false, toolUseID: toolUseId };
      case "cancel":
        return { behavior: "deny", message: CANCEL_MESSAGE, interrupt: true, toolUseID: toolUseId };
    }
  }
  return { behavior: "deny", message: DECLINE_MESSAGE, interrupt: false, toolUseID: toolUseId };
}

export const cancelledDecision = (toolUseId: string): PermissionDecision => ({
  behavior: "deny",
  message: CANCEL_MESSAGE,
  interrupt: true,
  toolUseID: toolUseId,
});

/** AskUserQuestion questions with ids `q<index>`. */
export function userInputQuestions(input: JsonRecord): readonly UserInputQuestion[] {
  const questions = Array.isArray(input["questions"]) ? input["questions"] : [];
  return questions.flatMap((question, index) => {
    if (!isRecord(question)) return [];
    const options = Array.isArray(question["options"]) ? question["options"] : [];
    return [
      {
        id: `q${index}`,
        header: str(question["header"]) ?? "",
        question: str(question["question"]) ?? "",
        options: options.flatMap((option) =>
          isRecord(option) ? [{ label: str(option["label"]) ?? "", description: str(option["description"]) ?? "" }] : [],
        ),
        multiSelect: question["multiSelect"] === true,
        secret: false,
        allowOther: true,
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
  if (!question.multiSelect) return joined;
  const parts = joined
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const labels = parts.map((part) => question.options.find((option) => option.label.toLowerCase() === part.toLowerCase())?.label);
  if (parts.length > 0 && labels.every((label): label is string => label !== undefined)) return labels.join(", ");
  return joined;
}

/** Maps a user-input response to the SDK `updatedInput.answers` (question text → answer). */
export function userInputDecision(
  response: RuntimeResponse,
  input: JsonRecord,
  questions: readonly UserInputQuestion[],
  toolUseId: string,
): PermissionDecision {
  if (response.type !== "userInput") {
    return { behavior: "deny", message: DECLINE_MESSAGE, interrupt: false, toolUseID: toolUseId };
  }
  const answers: Record<string, JsonValue> = {};
  for (const question of questions) {
    const answer = response.answers[question.id];
    if (answer === undefined) continue;
    answers[question.question] = normalizeAnswer(question, answer.answers);
  }
  return {
    behavior: "allow",
    updatedInput: { ...input, answers },
    updatedPermissions: null,
    toolUseID: toolUseId,
  };
}
