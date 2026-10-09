/**
 * Shape checks for the neutral model values the host persists or receives:
 * user content, settings, usage, turn errors, items and turns. Ids are
 * branded only after their check passed. Pure; no I/O.
 */

import type {
  AgentItem,
  AgentTurn,
  CallStatus,
  ExecutionStatus,
  FileChange,
  JsonValue,
  McpToolResult,
  Provenance,
  ThreadSettings,
  TokenUsage,
  TurnError,
  UserContent,
  WebSearchAction,
} from "../protocol.js";
import {
  asClientMessageId,
  asItemId,
  asProviderThreadRef,
  asTurnId,
  PROVIDER_ID,
} from "../protocol.js";
import { isRecord } from "../mapping/frames.js";
import {
  int,
  list,
  nullable,
  num,
  objectReader,
  oneOf,
  ShapeError,
  str,
  tagged,
  type Check,
  type ObjectReader,
} from "./checks.js";

/** Any JSON value, checked recursively. */
export const jsonValue: Check<JsonValue> = (value, path) => {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return num(value, path);
  }
  if (Array.isArray(value)) {
    return list(jsonValue)(value, path);
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, jsonValue(entry, `${path}.${key}`)]),
    );
  }
  throw new ShapeError(`${path}: expected JSON value`);
};

export const userContent: Check<UserContent> = tagged<UserContent>("type", {
  image: (reader) => ({ type: "image", url: reader.at("url", str) }),
  localImage: (reader) => ({ path: reader.at("path", str), type: "localImage" }),
  text: (reader) => ({ text: reader.at("text", str), type: "text" }),
});

export const threadSettings: Check<ThreadSettings> = (value, path) => {
  const reader = objectReader(value, path);
  return {
    effort: reader.at("effort", nullable(str)),
    model: reader.at("model", str),
    permissionProfile: reader.at("permissionProfile", str),
    serviceTier: reader.at("serviceTier", nullable(str)),
  };
};

export const tokenUsage: Check<TokenUsage> = (value, path) => {
  const reader = objectReader(value, path);
  return {
    cachedInputTokens: reader.at("cachedInputTokens", int),
    inputTokens: reader.at("inputTokens", int),
    outputTokens: reader.at("outputTokens", int),
    reasoningOutputTokens: reader.at("reasoningOutputTokens", int),
    totalTokens: reader.at("totalTokens", int),
  };
};

export const turnError: Check<TurnError> = (value, path) => {
  const reader = objectReader(value, path);
  return {
    kind: reader.at(
      "kind",
      oneOf([
        "provider",
        "authentication",
        "processExited",
        "sessionLost",
        "usageLimit",
        "unknown",
      ]),
    ),
    message: reader.at("message", str),
  };
};

const executionStatus: Check<ExecutionStatus> = oneOf([
  "inProgress",
  "completed",
  "failed",
  "declined",
]);
const callStatus: Check<CallStatus> = oneOf(["inProgress", "completed", "failed"]);

const fileChange: Check<FileChange> = (value, path) => {
  const reader = objectReader(value, path);
  return {
    diff: reader.at("diff", str),
    kind: reader.at("kind", oneOf(["add", "delete", "update"])),
    movePath: reader.at("movePath", nullable(str)),
    path: reader.at("path", str),
  };
};

const webSearchAction: Check<WebSearchAction> = tagged<WebSearchAction>("type", {
  openPage: (reader) => ({ type: "openPage", url: reader.at("url", str) }),
  search: (reader) => ({ query: reader.at("query", str), type: "search" }),
});

const mcpToolResult: Check<McpToolResult> = (value, path) => {
  const reader = objectReader(value, path);
  return {
    content: reader.at("content", list(jsonValue)),
    structuredContent: reader.at("structuredContent", jsonValue),
  };
};

const itemId = (reader: ObjectReader): AgentItem["itemId"] => asItemId(reader.at("itemId", str));

const toolItems = {
  command: (reader: ObjectReader): AgentItem => ({
    command: reader.at("command", str),
    cwd: reader.at("cwd", str),
    durationMs: reader.at("durationMs", nullable(num)),
    exitCode: reader.at("exitCode", nullable(int)),
    itemId: itemId(reader),
    output: reader.at("output", nullable(str)),
    status: reader.at("status", executionStatus),
    type: "command",
  }),
  fileChange: (reader: ObjectReader): AgentItem => ({
    changes: reader.at("changes", list(fileChange)),
    itemId: itemId(reader),
    status: reader.at("status", executionStatus),
    type: "fileChange",
  }),
  mcpToolCall: (reader: ObjectReader): AgentItem => ({
    arguments: reader.at("arguments", jsonValue),
    durationMs: reader.at("durationMs", nullable(num)),
    error: reader.at("error", nullable(str)),
    itemId: itemId(reader),
    result: reader.at("result", nullable(mcpToolResult)),
    server: reader.at("server", str),
    status: reader.at("status", callStatus),
    tool: reader.at("tool", str),
    type: "mcpToolCall",
  }),
  toolCall: (reader: ObjectReader): AgentItem => ({
    arguments: reader.at("arguments", jsonValue),
    durationMs: reader.at("durationMs", nullable(num)),
    itemId: itemId(reader),
    namespace: reader.at("namespace", nullable(str)),
    output: reader.at("output", nullable(str)),
    status: reader.at("status", callStatus),
    tool: reader.at("tool", str),
    type: "toolCall",
  }),
};

const messageItems = {
  agentMessage: (reader: ObjectReader): AgentItem => ({
    itemId: itemId(reader),
    phase: reader.at("phase", oneOf(["commentary", "final"])),
    text: reader.at("text", str),
    type: "agentMessage",
  }),
  reasoning: (reader: ObjectReader): AgentItem => ({
    content: reader.at("content", list(str)),
    itemId: itemId(reader),
    summary: reader.at("summary", list(str)),
    type: "reasoning",
  }),
  userMessage: (reader: ObjectReader): AgentItem => {
    const clientMessageId = reader.at("clientMessageId", nullable(str));
    return {
      clientMessageId: clientMessageId === null ? null : asClientMessageId(clientMessageId),
      content: reader.at("content", list(userContent)),
      itemId: itemId(reader),
      type: "userMessage",
    };
  },
};

const otherItems = {
  capabilityItem: (reader: ObjectReader): AgentItem => ({
    capability: reader.at("capability", str),
    itemId: itemId(reader),
    kind: reader.at("kind", str),
    payload: reader.at("payload", jsonValue),
    type: "capabilityItem",
  }),
  compaction: (reader: ObjectReader): AgentItem => ({ itemId: itemId(reader), type: "compaction" }),
  imageView: (reader: ObjectReader): AgentItem => ({
    itemId: itemId(reader),
    path: reader.at("path", str),
    type: "imageView",
  }),
  plan: (reader: ObjectReader): AgentItem => ({
    itemId: itemId(reader),
    text: reader.at("text", str),
    type: "plan",
  }),
  webSearch: (reader: ObjectReader): AgentItem => ({
    action: reader.at("action", nullable(webSearchAction)),
    itemId: itemId(reader),
    query: reader.at("query", str),
    type: "webSearch",
  }),
};

/** The host records only its own provider. */
const claudeProvider: Check<Provenance["provider"]> = (value, path) => {
  if (value !== PROVIDER_ID) {
    throw new ShapeError(`${path}: expected ${PROVIDER_ID}`);
  }
  return PROVIDER_ID;
};

const provenance: Check<Provenance> = (value, path) => {
  const reader = objectReader(value, path);
  return {
    nativeThreadId: asProviderThreadRef(reader.at("nativeThreadId", str)),
    provider: reader.at("provider", claudeProvider),
  };
};

/** The optional `provenance` field: omitted when absent. */
const withProvenanceOf = (value: unknown, path: string): { readonly provenance?: Provenance } => {
  const origin = objectReader(value, path).at("provenance", nullable(provenance));
  return origin === null ? {} : { provenance: origin };
};

const itemBody: Check<AgentItem> = tagged<AgentItem>("type", {
  ...messageItems,
  ...otherItems,
  ...toolItems,
});

export const agentItem: Check<AgentItem> = (value, path) => ({
  ...itemBody(value, path),
  ...withProvenanceOf(value, path),
});

export const agentTurn: Check<AgentTurn> = (value, path) => {
  const reader = objectReader(value, path);
  return {
    completedAt: reader.at("completedAt", nullable(int)),
    error: reader.at("error", nullable(turnError)),
    items: reader.at("items", list(agentItem)),
    origin: reader.at("origin", oneOf(["user", "provider"])),
    startedAt: reader.at("startedAt", int),
    status: reader.at("status", oneOf(["inProgress", "completed", "interrupted", "failed"])),
    turnId: asTurnId(reader.at("turnId", str)),
    ...withProvenanceOf(value, path),
  };
};
