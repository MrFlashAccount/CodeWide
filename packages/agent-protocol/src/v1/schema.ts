/**
 * Runtime shape checks for `codewide-agent` v1 messages.
 *
 * The checks are exact: every declared field must be present with its type
 * and undeclared fields are reported. They validate fixtures and inbound
 * messages at a trust boundary; they never coerce or mutate a value.
 * `checkMessage` returns the list of violations (empty when valid).
 */

import { BOOLEAN_CAPABILITIES, START_WHILE_ACTIVE_CAPABILITY } from "./capabilities";
import { OPERATION_NAMES, type OperationName } from "./operations";

type Check = (value: unknown, path: string, errors: string[]) => void;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str: Check = (value, path, errors) => {
  if (typeof value !== "string") {
    errors.push(`${path}: expected string`);
  }
};
const int: Check = (value, path, errors) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    errors.push(`${path}: expected integer`);
  }
};
const bool: Check = (value, path, errors) => {
  if (typeof value !== "boolean") {
    errors.push(`${path}: expected boolean`);
  }
};
const json: Check = () => {};
const nullable =
  (inner: Check): Check =>
  (value, path, errors) => {
    if (value !== null) {
      inner(value, path, errors);
    }
  };
const literal =
  (...allowed: readonly (string | number)[]): Check =>
  (value, path, errors) => {
    if (typeof value !== "string" && typeof value !== "number") {
      errors.push(`${path}: expected one of ${allowed.join(", ")}`);
      return;
    }
    if (!allowed.includes(value)) {
      errors.push(`${path}: unexpected ${String(value)}`);
    }
  };
const arr =
  (inner: Check): Check =>
  (value, path, errors) => {
    if (!Array.isArray(value)) {
      errors.push(`${path}: expected array`);
      return;
    }
    value.forEach((entry: unknown, index) => {
      inner(entry, `${path}[${String(index)}]`, errors);
    });
  };
/** Checks that may be absent: an absent field is valid, a present one is checked. */
const optionalChecks = new WeakSet<Check>();
const optional = (inner: Check): Check => {
  const check: Check = (value, path, errors) => {
    inner(value, path, errors);
  };
  optionalChecks.add(check);
  return check;
};
const obj =
  (fields: Readonly<Record<string, Check>>): Check =>
  (value, path, errors) => {
    if (!isRecord(value)) {
      errors.push(`${path}: expected object`);
      return;
    }
    for (const [key, check] of Object.entries(fields)) {
      if (!(key in value)) {
        if (!optionalChecks.has(check)) {
          errors.push(`${path}.${key}: missing`);
        }
        continue;
      }
      check(value[key], `${path}.${key}`, errors);
    }
    for (const key of Object.keys(value)) {
      if (!(key in fields)) {
        errors.push(`${path}.${key}: undeclared field`);
      }
    }
  };
const map =
  (inner: Check): Check =>
  (value, path, errors) => {
    if (!isRecord(value)) {
      errors.push(`${path}: expected object`);
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      inner(entry, `${path}.${key}`, errors);
    }
  };
const tagged =
  (tag: string, variants: Readonly<Record<string, Readonly<Record<string, Check>>>>): Check =>
  (value, path, errors) => {
    if (!isRecord(value)) {
      errors.push(`${path}: expected object`);
      return;
    }
    const discriminator = value[tag];
    if (typeof discriminator !== "string" || !(discriminator in variants)) {
      errors.push(`${path}.${tag}: unknown variant ${String(discriminator)}`);
      return;
    }
    const fields = variants[discriminator] ?? {};
    obj({ [tag]: str, ...fields })(value, path, errors);
  };
const emptyObject: Check = obj({});

const capabilitySet: Check = obj({
  ...Object.fromEntries(BOOLEAN_CAPABILITIES.map((name) => [name, bool])),
  [START_WHILE_ACTIVE_CAPABILITY]: literal("busy", "nativeJoin"),
});

const settings = obj({
  effort: nullable(str),
  model: str,
  permissionProfile: str,
  serviceTier: nullable(str),
});
const thread = obj({
  appThreadId: str,
  archived: bool,
  createdAt: int,
  cwd: str,
  name: nullable(str),
  origin: literal("interactive", "external", "supervisor"),
  preview: str,
  provider: str,
  recencyAt: nullable(int),
  settings,
  status: literal("idle", "active", "notLoaded", "failed"),
  updatedAt: int,
});
const userContent = tagged("type", {
  image: { url: str },
  localImage: { path: str },
  text: { text: str },
});
const executionStatus = literal("inProgress", "completed", "failed", "declined");
const callStatus = literal("inProgress", "completed", "failed");
const fileChange = obj({
  diff: str,
  kind: literal("add", "delete", "update"),
  movePath: nullable(str),
  path: str,
});
const provenance = optional(obj({ nativeThreadId: str, provider: str }));
/** Adds the optional `provenance` field to every variant. */
const withProvenance = (
  variants: Readonly<Record<string, Readonly<Record<string, Check>>>>,
): Readonly<Record<string, Readonly<Record<string, Check>>>> =>
  Object.fromEntries(
    Object.entries(variants).map(([name, fields]) => [name, { ...fields, provenance }]),
  );
const item = tagged(
  "type",
  withProvenance({
    agentMessage: { itemId: str, phase: literal("commentary", "final"), text: str },
    capabilityItem: { capability: str, itemId: str, kind: str, payload: json },
    command: {
      command: str,
      cwd: str,
      durationMs: nullable(int),
      exitCode: nullable(int),
      itemId: str,
      output: nullable(str),
      status: executionStatus,
    },
    compaction: { itemId: str },
    fileChange: { changes: arr(fileChange), itemId: str, status: executionStatus },
    imageView: { itemId: str, path: str },
    mcpToolCall: {
      arguments: json,
      durationMs: nullable(int),
      error: nullable(str),
      itemId: str,
      result: nullable(obj({ content: arr(json), structuredContent: json })),
      server: str,
      status: callStatus,
      tool: str,
    },
    plan: { itemId: str, text: str },
    reasoning: { content: arr(str), itemId: str, summary: arr(str) },
    toolCall: {
      arguments: json,
      durationMs: nullable(int),
      itemId: str,
      namespace: nullable(str),
      output: nullable(str),
      status: callStatus,
      tool: str,
    },
    userMessage: { clientMessageId: nullable(str), content: arr(userContent), itemId: str },
    webSearch: {
      action: nullable(tagged("type", { openPage: { url: str }, search: { query: str } })),
      itemId: str,
      query: str,
    },
  }),
);
const turn = obj({
  completedAt: nullable(int),
  error: nullable(
    obj({
      kind: literal(
        "provider",
        "authentication",
        "processExited",
        "sessionLost",
        "usageLimit",
        "unknown",
      ),
      message: str,
    }),
  ),
  items: arr(item),
  origin: literal("user", "provider"),
  provenance,
  startedAt: int,
  status: literal("inProgress", "completed", "interrupted", "failed"),
  turnId: str,
});

const codewideMetadata = obj({
  createdAt: int,
  cwd: str,
  origin: literal("interactive", "external"),
  presence: tagged("type", { deleted: { deletedAt: int }, listed: { archived: bool } }),
  recencyAt: nullable(int),
  settings,
  title: tagged("type", {
    cleared: { hiddenTitle: str },
    none: {},
    pending: { name: str },
  }),
  updatedAt: int,
});

const nativeSession = obj({
  appThreadId: str,
  codewide: optional(codewideMetadata),
  createdAtMs: nullable(int),
  cwd: nullable(str),
  fileSize: nullable(int),
  firstPrompt: nullable(str),
  interactive: bool,
  lastModifiedMs: int,
  sessionId: str,
  summary: str,
  title: nullable(str),
});

const nativeSubagent = obj({
  agentId: str,
  parentAgentId: nullable(str),
  parentToolUseId: nullable(str),
  turns: arr(turn),
});
const decision = literal("accept", "acceptForSession", "decline", "cancel");
const runtimeRequest = tagged("type", {
  approval: {
    command: nullable(str),
    cwd: nullable(str),
    decisions: arr(decision),
    detail: nullable(str),
    itemId: str,
    kind: literal("command", "fileChange", "tool"),
    title: str,
  },
  capabilityRequest: { capability: str, payload: json },
  userInput: {
    itemId: str,
    questions: arr(
      obj({
        allowOther: bool,
        header: str,
        id: str,
        multiSelect: bool,
        options: arr(obj({ description: str, label: str })),
        question: str,
        secret: bool,
      }),
    ),
  },
});
const runtimeResponse = tagged("type", {
  approval: { decision },
  capability: { payload: json },
  error: { message: str },
  userInput: { answers: map(obj({ answers: arr(str) })) },
});
const nativeRequestId: Check = (value, path, errors) => {
  if (typeof value !== "string" && !(typeof value === "number" && Number.isSafeInteger(value))) {
    errors.push(`${path}: expected string or integer request id`);
  }
};
const tokenUsage = obj({
  cachedInputTokens: int,
  inputTokens: int,
  outputTokens: int,
  reasoningOutputTokens: int,
  totalTokens: int,
});
const delta = tagged("kind", {
  fileChanges: { changes: arr(fileChange) },
  output: { text: str },
  reasoning: { summaryIndex: int, text: str },
  text: { text: str },
});

/** Shape check of one `AgentEvent`. */
export const checkEvent: Check = tagged("type", {
  "capability.event": { appThreadId: nullable(str), capability: str, payload: json },
  "diff.updated": { appThreadId: str, diff: str, turnId: str },
  "item.completed": { appThreadId: str, item, turnId: str },
  "item.delta": { appThreadId: str, delta, itemId: str, turnId: str },
  "item.started": { appThreadId: str, item, turnId: str },
  "plan.updated": {
    appThreadId: str,
    explanation: nullable(str),
    plan: arr(obj({ status: literal("pending", "inProgress", "completed"), step: str })),
    turnId: str,
  },
  "request.opened": {
    appThreadId: str,
    request: runtimeRequest,
    requestId: nativeRequestId,
    turnId: str,
  },
  "request.resolved": {
    appThreadId: str,
    reason: literal("responded", "cancelled", "turnEnded", "providerRestarted"),
    requestId: nativeRequestId,
  },
  "thread.updated": { thread },
  "turn.completed": { appThreadId: str, turn },
  "turn.started": { appThreadId: str, turn },
  "usage.updated": {
    appThreadId: str,
    contextWindow: nullable(int),
    last: tokenUsage,
    total: tokenUsage,
    turnId: str,
  },
});

const sortWindow = obj({
  lower: nullable(int),
  lowerInclusive: bool,
  upper: nullable(int),
  upperInclusive: bool,
});
const sortDirection = literal("asc", "desc");

const operationChecks: Readonly<
  Record<OperationName, { readonly params: Check; readonly result: Check }>
> = {
  "capability.invoke": {
    params: obj({ capability: str, method: str, params: json }),
    result: obj({ result: json }),
  },
  "catalog.models": {
    params: emptyObject,
    result: obj({
      models: arr(
        obj({
          defaultEffort: nullable(str),
          description: str,
          displayName: str,
          efforts: arr(obj({ description: str, effort: str })),
          hidden: bool,
          id: str,
          inputModalities: arr(literal("text", "image")),
          isDefault: bool,
          model: str,
        }),
      ),
    }),
  },
  "catalog.permissionProfiles": {
    params: emptyObject,
    result: obj({ profiles: arr(obj({ description: str, displayName: str, id: str })) }),
  },
  initialize: {
    params: obj({
      client: obj({ name: str, version: str }),
      protocol: literal("codewide-agent"),
      protocolVersion: int,
    }),
    result: obj({
      account: nullable(obj({ authenticated: bool, label: nullable(str) })),
      capabilities: capabilitySet,
      protocolVersion: literal(1),
      provider: obj({ displayName: str, id: str, modelProvider: str, version: str }),
    }),
  },
  "nativeSession.list": {
    params: obj({ cursor: nullable(str), dir: nullable(str), limit: int }),
    result: obj({ nextCursor: nullable(str), sessions: arr(nativeSession) }),
  },
  "nativeSession.read": {
    params: obj({ sessionId: str }),
    result: obj({ session: nativeSession, subagents: arr(nativeSubagent), turns: arr(turn) }),
  },
  "request.respond": {
    params: obj({ appThreadId: str, requestId: nativeRequestId, response: runtimeResponse }),
    result: emptyObject,
  },
  "thread.compact": { params: obj({ appThreadId: str }), result: emptyObject },
  "thread.create": {
    params: obj({ appThreadId: nullable(str), cwd: str, settings }),
    result: obj({ thread }),
  },
  "thread.list": {
    params: obj({
      archived: bool,
      cursor: nullable(str),
      cwd: nullable(str),
      limit: int,
      searchTerm: nullable(str),
      sortDirection,
      sortKey: literal("createdAt", "updatedAt", "recencyAt"),
      window: nullable(sortWindow),
    }),
    result: obj({ nextCursor: nullable(str), threads: arr(thread) }),
  },
  "thread.owns": { params: obj({ appThreadId: str }), result: obj({ owned: bool }) },
  "thread.read": {
    params: obj({ appThreadId: str }),
    result: obj({ activeTurnId: nullable(str), thread }),
  },
  "thread.turns": {
    params: obj({
      appThreadId: str,
      cursor: nullable(str),
      itemsView: literal("notLoaded", "summary", "full"),
      limit: int,
      sortDirection,
    }),
    result: obj({ nextCursor: nullable(str), turns: arr(turn) }),
  },
  "thread.update": {
    params: obj({
      appThreadId: str,
      change: tagged("type", {
        archived: { archived: bool },
        deleted: {},
        name: { name: nullable(str) },
        settings: {
          effort: nullable(str),
          model: nullable(str),
          permissionProfile: nullable(str),
          serviceTier: nullable(str),
        },
      }),
    }),
    result: obj({ thread: nullable(thread) }),
  },
  "turn.interrupt": {
    params: obj({ appThreadId: str, turnId: nullable(str) }),
    result: emptyObject,
  },
  "turn.start": {
    params: obj({ appThreadId: str, clientMessageId: nullable(str), input: arr(userContent) }),
    result: tagged("type", { busy: { activeTurnId: str }, started: { turnId: str } }),
  },
  "turn.steer": {
    params: obj({
      appThreadId: str,
      clientMessageId: nullable(str),
      expectedTurnId: str,
      input: arr(userContent),
    }),
    result: obj({ turnId: str }),
  },
};

const rpcId: Check = (value, path, errors) => {
  if (typeof value !== "string" && !(typeof value === "number" && Number.isSafeInteger(value))) {
    errors.push(`${path}: expected string or integer id`);
  }
};

const OPERATION_NAME_SET: ReadonlySet<unknown> = new Set<unknown>(OPERATION_NAMES);

const isOperationName = (value: unknown): value is OperationName => OPERATION_NAME_SET.has(value);

const checkRequest = (
  value: Readonly<Record<string, unknown>>,
  errors: string[],
): readonly string[] => {
  const method = value["method"];
  if (method === "event") {
    obj({ method: str, params: checkEvent })(value, "$", errors);
    return errors;
  }
  if (method === "initialized") {
    obj({ method: str })(value, "$", errors);
    return errors;
  }
  if (!isOperationName(method)) {
    return [`$.method: unknown operation ${String(method)}`];
  }
  obj({ id: rpcId, method: str, params: operationChecks[method].params })(value, "$", errors);
  return errors;
};

const checkError: Check = obj({
  error: obj({
    code: int,
    data: nullable(obj({ capability: nullable(str), provider: nullable(str) })),
    message: str,
  }),
  id: rpcId,
});

/**
 * Checks one protocol message. Responses are checked against the result of
 * `respondsTo`, the method of the request they answer.
 */
export function checkMessage(
  value: unknown,
  respondsTo: OperationName | null = null,
): readonly string[] {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return ["$: expected object"];
  }
  if ("method" in value) {
    return checkRequest(value, errors);
  }
  if ("error" in value) {
    checkError(value, "$", errors);
    return errors;
  }
  if (respondsTo === null) {
    return ["$: a response needs the operation it answers"];
  }
  obj({ id: rpcId, result: operationChecks[respondsTo].result })(value, "$", errors);
  return errors;
}
