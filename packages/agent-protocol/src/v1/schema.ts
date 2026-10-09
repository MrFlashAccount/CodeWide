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
  if (typeof value !== "string") errors.push(`${path}: expected string`);
};
const int: Check = (value, path, errors) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) errors.push(`${path}: expected integer`);
};
const bool: Check = (value, path, errors) => {
  if (typeof value !== "boolean") errors.push(`${path}: expected boolean`);
};
const json: Check = () => {};
const nullable =
  (inner: Check): Check =>
  (value, path, errors) => {
    if (value !== null) inner(value, path, errors);
  };
const literal =
  (...allowed: readonly (string | number)[]): Check =>
  (value, path, errors) => {
    if (typeof value !== "string" && typeof value !== "number") {
      errors.push(`${path}: expected one of ${allowed.join(", ")}`);
      return;
    }
    if (!allowed.includes(value)) errors.push(`${path}: unexpected ${String(value)}`);
  };
const arr =
  (inner: Check): Check =>
  (value, path, errors) => {
    if (!Array.isArray(value)) {
      errors.push(`${path}: expected array`);
      return;
    }
    value.forEach((entry: unknown, index) => inner(entry, `${path}[${index}]`, errors));
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
        errors.push(`${path}.${key}: missing`);
        continue;
      }
      check(value[key], `${path}.${key}`, errors);
    }
    for (const key of Object.keys(value)) {
      if (!(key in fields)) errors.push(`${path}.${key}: undeclared field`);
    }
  };
const map =
  (inner: Check): Check =>
  (value, path, errors) => {
    if (!isRecord(value)) {
      errors.push(`${path}: expected object`);
      return;
    }
    for (const [key, entry] of Object.entries(value)) inner(entry, `${path}.${key}`, errors);
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

const settings = obj({ model: str, effort: nullable(str), permissionProfile: str, serviceTier: nullable(str) });
const thread = obj({
  appThreadId: str,
  provider: str,
  cwd: str,
  name: nullable(str),
  preview: str,
  createdAt: int,
  updatedAt: int,
  recencyAt: nullable(int),
  archived: bool,
  origin: literal("interactive", "external", "supervisor"),
  status: literal("idle", "active", "notLoaded", "failed"),
  settings,
});
const userContent = tagged("type", {
  text: { text: str },
  image: { url: str },
  localImage: { path: str },
});
const executionStatus = literal("inProgress", "completed", "failed", "declined");
const callStatus = literal("inProgress", "completed", "failed");
const fileChange = obj({ path: str, kind: literal("add", "delete", "update"), movePath: nullable(str), diff: str });
const item = tagged("type", {
  userMessage: { itemId: str, clientMessageId: nullable(str), content: arr(userContent) },
  agentMessage: { itemId: str, text: str, phase: literal("commentary", "final") },
  reasoning: { itemId: str, summary: arr(str), content: arr(str) },
  command: {
    itemId: str,
    command: str,
    cwd: str,
    status: executionStatus,
    output: nullable(str),
    exitCode: nullable(int),
    durationMs: nullable(int),
  },
  fileChange: { itemId: str, changes: arr(fileChange), status: executionStatus },
  mcpToolCall: {
    itemId: str,
    server: str,
    tool: str,
    arguments: json,
    status: callStatus,
    result: nullable(obj({ content: arr(json), structuredContent: json })),
    error: nullable(str),
    durationMs: nullable(int),
  },
  toolCall: {
    itemId: str,
    namespace: nullable(str),
    tool: str,
    arguments: json,
    output: nullable(str),
    status: callStatus,
    durationMs: nullable(int),
  },
  webSearch: {
    itemId: str,
    query: str,
    action: nullable(tagged("type", { search: { query: str }, openPage: { url: str } })),
  },
  imageView: { itemId: str, path: str },
  plan: { itemId: str, text: str },
  compaction: { itemId: str },
  capabilityItem: { itemId: str, capability: str, kind: str, payload: json },
});
const turn = obj({
  turnId: str,
  status: literal("inProgress", "completed", "interrupted", "failed"),
  origin: literal("user", "provider"),
  startedAt: int,
  completedAt: nullable(int),
  error: nullable(
    obj({
      kind: literal("provider", "authentication", "processExited", "sessionLost", "usageLimit", "unknown"),
      message: str,
    }),
  ),
  items: arr(item),
});
const decision = literal("accept", "acceptForSession", "decline", "cancel");
const runtimeRequest = tagged("type", {
  approval: {
    kind: literal("command", "fileChange", "tool"),
    itemId: str,
    title: str,
    detail: nullable(str),
    command: nullable(str),
    cwd: nullable(str),
    decisions: arr(decision),
  },
  userInput: {
    itemId: str,
    questions: arr(
      obj({
        id: str,
        header: str,
        question: str,
        options: arr(obj({ label: str, description: str })),
        multiSelect: bool,
        secret: bool,
        allowOther: bool,
      }),
    ),
  },
  capabilityRequest: { capability: str, payload: json },
});
const runtimeResponse = tagged("type", {
  approval: { decision },
  userInput: { answers: map(obj({ answers: arr(str) })) },
  capability: { payload: json },
  error: { message: str },
});
const nativeRequestId: Check = (value, path, errors) => {
  if (typeof value !== "string" && !(typeof value === "number" && Number.isSafeInteger(value))) {
    errors.push(`${path}: expected string or integer request id`);
  }
};
const tokenUsage = obj({
  inputTokens: int,
  cachedInputTokens: int,
  outputTokens: int,
  reasoningOutputTokens: int,
  totalTokens: int,
});
const delta = tagged("kind", {
  text: { text: str },
  reasoning: { text: str, summaryIndex: int },
  output: { text: str },
  fileChanges: { changes: arr(fileChange) },
});

/** Shape check of one `AgentEvent`. */
export const checkEvent: Check = tagged("type", {
  "thread.updated": { thread },
  "turn.started": { appThreadId: str, turn },
  "turn.completed": { appThreadId: str, turn },
  "item.started": { appThreadId: str, turnId: str, item },
  "item.delta": { appThreadId: str, turnId: str, itemId: str, delta },
  "item.completed": { appThreadId: str, turnId: str, item },
  "request.opened": { appThreadId: str, turnId: str, requestId: nativeRequestId, request: runtimeRequest },
  "request.resolved": {
    appThreadId: str,
    requestId: nativeRequestId,
    reason: literal("responded", "cancelled", "turnEnded", "providerRestarted"),
  },
  "usage.updated": {
    appThreadId: str,
    turnId: str,
    last: tokenUsage,
    total: tokenUsage,
    contextWindow: nullable(int),
  },
  "plan.updated": {
    appThreadId: str,
    turnId: str,
    explanation: nullable(str),
    plan: arr(obj({ step: str, status: literal("pending", "inProgress", "completed") })),
  },
  "diff.updated": { appThreadId: str, turnId: str, diff: str },
  "capability.event": { appThreadId: nullable(str), capability: str, payload: json },
});

const sortWindow = obj({ lower: nullable(int), lowerInclusive: bool, upper: nullable(int), upperInclusive: bool });
const sortDirection = literal("asc", "desc");

const operationChecks: Readonly<Record<OperationName, { readonly params: Check; readonly result: Check }>> = {
  initialize: {
    params: obj({ protocol: literal("codewide-agent"), protocolVersion: int, client: obj({ name: str, version: str }) }),
    result: obj({
      protocolVersion: literal(1),
      provider: obj({ id: str, displayName: str, modelProvider: str, version: str }),
      capabilities: capabilitySet,
      account: nullable(obj({ authenticated: bool, label: nullable(str) })),
    }),
  },
  "catalog.models": {
    params: emptyObject,
    result: obj({
      models: arr(
        obj({
          id: str,
          model: str,
          displayName: str,
          description: str,
          isDefault: bool,
          hidden: bool,
          efforts: arr(obj({ effort: str, description: str })),
          defaultEffort: nullable(str),
          inputModalities: arr(literal("text", "image")),
        }),
      ),
    }),
  },
  "catalog.permissionProfiles": {
    params: emptyObject,
    result: obj({ profiles: arr(obj({ id: str, displayName: str, description: str })) }),
  },
  "thread.create": {
    params: obj({ appThreadId: nullable(str), cwd: str, settings }),
    result: obj({ thread }),
  },
  "thread.read": {
    params: obj({ appThreadId: str }),
    result: obj({ thread, activeTurnId: nullable(str) }),
  },
  "thread.list": {
    params: obj({
      archived: bool,
      cwd: nullable(str),
      searchTerm: nullable(str),
      sortKey: literal("createdAt", "updatedAt", "recencyAt"),
      sortDirection,
      window: nullable(sortWindow),
      cursor: nullable(str),
      limit: int,
    }),
    result: obj({ threads: arr(thread), nextCursor: nullable(str) }),
  },
  "thread.turns": {
    params: obj({
      appThreadId: str,
      cursor: nullable(str),
      limit: int,
      sortDirection,
      itemsView: literal("notLoaded", "summary", "full"),
    }),
    result: obj({ turns: arr(turn), nextCursor: nullable(str) }),
  },
  "thread.update": {
    params: obj({
      appThreadId: str,
      change: tagged("type", {
        name: { name: nullable(str) },
        archived: { archived: bool },
        deleted: {},
        settings: {
          model: nullable(str),
          effort: nullable(str),
          permissionProfile: nullable(str),
          serviceTier: nullable(str),
        },
      }),
    }),
    result: obj({ thread: nullable(thread) }),
  },
  "thread.owns": { params: obj({ appThreadId: str }), result: obj({ owned: bool }) },
  "thread.compact": { params: obj({ appThreadId: str }), result: emptyObject },
  "turn.start": {
    params: obj({ appThreadId: str, clientMessageId: nullable(str), input: arr(userContent) }),
    result: tagged("type", { started: { turnId: str }, busy: { activeTurnId: str } }),
  },
  "turn.steer": {
    params: obj({ appThreadId: str, expectedTurnId: str, clientMessageId: nullable(str), input: arr(userContent) }),
    result: obj({ turnId: str }),
  },
  "turn.interrupt": { params: obj({ appThreadId: str, turnId: nullable(str) }), result: emptyObject },
  "request.respond": {
    params: obj({ appThreadId: str, requestId: nativeRequestId, response: runtimeResponse }),
    result: emptyObject,
  },
  "capability.invoke": {
    params: obj({ capability: str, method: str, params: json }),
    result: obj({ result: json }),
  },
};

const rpcId: Check = (value, path, errors) => {
  if (typeof value !== "string" && !(typeof value === "number" && Number.isSafeInteger(value))) {
    errors.push(`${path}: expected string or integer id`);
  }
};

const isOperationName = (value: unknown): value is OperationName =>
  typeof value === "string" && (OPERATION_NAMES as readonly string[]).includes(value);

/**
 * Checks one protocol message. Responses are checked against the result of
 * `respondsTo`, the method of the request they answer.
 */
export function checkMessage(value: unknown, respondsTo: OperationName | null = null): readonly string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ["$: expected object"];
  if (value["method"] === "event") {
    obj({ method: str, params: checkEvent })(value, "$", errors);
    return errors;
  }
  if (value["method"] === "initialized") {
    obj({ method: str })(value, "$", errors);
    return errors;
  }
  if ("method" in value) {
    const method = value["method"];
    if (!isOperationName(method)) return [`$.method: unknown operation ${String(method)}`];
    obj({ id: rpcId, method: str, params: operationChecks[method].params })(value, "$", errors);
    return errors;
  }
  if ("error" in value) {
    obj({
      id: rpcId,
      error: obj({
        code: int,
        message: str,
        data: nullable(obj({ capability: nullable(str), provider: nullable(str) })),
      }),
    })(value, "$", errors);
    return errors;
  }
  if (respondsTo === null) return ["$: a response needs the operation it answers"];
  obj({ id: rpcId, result: operationChecks[respondsTo].result })(value, "$", errors);
  return errors;
}
