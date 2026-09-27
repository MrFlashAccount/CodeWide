import {
  parseGlobalSupervisorQualifiedChatRef,
  type GlobalSupervisorQualifiedChatRef,
} from "./globalSupervisorBinding";
import {
  globalSupervisorAttachmentLimits,
  isGlobalSupervisorAttachmentId,
  type GlobalSupervisorChatAttachmentList,
  type GlobalSupervisorChatAttachmentText,
} from "./globalSupervisorChatAttachments";
import type { GlobalSupervisorChatInspection } from "./globalSupervisorChatInspection";
import { globalSupervisorLimitsV1 } from "./globalSupervisorLimitsV1";
import type { GlobalSupervisorRequestAnswer } from "./globalSupervisorPendingRequest";
import type {
  GlobalSupervisorActiveWorkSnapshot,
  GlobalSupervisorFindChatResult,
} from "./globalSupervisorWorkSnapshot";
import { unknownRecord } from "./unknownRecord";

type GlobalSupervisorChatSummary = GlobalSupervisorQualifiedChatRef & {
  readonly preview: string;
  readonly title: string;
};

export type GlobalSupervisorChatItem = {
  readonly id: string;
  readonly kind: "assistant" | "user";
  readonly text: string;
};

type GlobalSupervisorChatPage = {
  readonly cursor: string | null;
  readonly items: readonly GlobalSupervisorChatSummary[];
};

type GlobalSupervisorHistoryPage = {
  readonly cursor: string | null;
  readonly items: readonly GlobalSupervisorChatItem[];
};

export type GlobalSupervisorToolCapabilities = {
  readonly assertLiveTarget: (target: GlobalSupervisorQualifiedChatRef) => void;
  readonly deriveTargetSendCommandId: (request: {
    readonly connectionId: string;
    readonly requestId: string | number;
  }) => Promise<string>;
  readonly deriveWorkerCreationSource: (request: {
    readonly connectionId: string;
    readonly requestId: string | number;
  }) => Promise<string>;
  readonly findChat: (
    supervisor: GlobalSupervisorQualifiedChatRef,
    request: {
      readonly connectionId: string | null;
      readonly project: string | null;
      readonly title: string | null;
      readonly topic: string | null;
    },
  ) => Promise<GlobalSupervisorFindChatResult>;
  readonly followChat: (
    supervisor: GlobalSupervisorQualifiedChatRef,
    target: GlobalSupervisorQualifiedChatRef,
  ) => Promise<void>;
  readonly inspectChat: (
    target: GlobalSupervisorQualifiedChatRef,
  ) => Promise<GlobalSupervisorChatInspection>;
  readonly interruptChat: (target: GlobalSupervisorQualifiedChatRef) => Promise<{
    readonly status: "alreadyIdle" | "interruptRequested";
    readonly target: GlobalSupervisorQualifiedChatRef;
    readonly turnId: string | null;
  }>;
  readonly listActiveWork: (
    supervisor: GlobalSupervisorQualifiedChatRef,
  ) => Promise<GlobalSupervisorActiveWorkSnapshot>;
  readonly listChatAttachments: (
    target: GlobalSupervisorQualifiedChatRef,
  ) => Promise<GlobalSupervisorChatAttachmentList>;
  readonly listChats: (cursor: string | null, limit: number) => Promise<GlobalSupervisorChatPage>;
  readonly readChat: (request: {
    readonly cursor: string | null;
    readonly limit: number;
    readonly maxBytes: number;
    readonly target: GlobalSupervisorQualifiedChatRef;
  }) => Promise<GlobalSupervisorHistoryPage>;
  readonly readChatAttachment: (request: {
    readonly attachmentId: string;
    readonly offset: number;
    readonly target: GlobalSupervisorQualifiedChatRef;
  }) => Promise<GlobalSupervisorChatAttachmentText>;
  readonly respond: (request: {
    readonly connectionId: string;
    readonly requestId: string | number;
    readonly result: unknown;
  }) => Promise<void>;
  readonly respondToRequest: (request: {
    readonly answer: GlobalSupervisorRequestAnswer;
    readonly eventId: string;
    readonly target: GlobalSupervisorQualifiedChatRef;
  }) => Promise<{ readonly eventId: string; readonly responded: true }>;
  readonly sendText: (request: {
    readonly commandId: string;
    readonly supervisor: GlobalSupervisorQualifiedChatRef;
    readonly target: GlobalSupervisorQualifiedChatRef;
    readonly text: string;
  }) => Promise<string>;
  readonly setSpokenAttention: (request: {
    readonly durationMinutes: number | null;
    readonly mode: "active" | "muted" | "snoozed";
    readonly supervisor: GlobalSupervisorQualifiedChatRef;
    readonly target: GlobalSupervisorQualifiedChatRef;
  }) => Promise<
    { readonly mode: "active" | "muted" } | { readonly mode: "snoozed"; readonly until: number }
  >;
  readonly startTask: (request: {
    readonly commandId: string;
    readonly connectionId: string;
    readonly cwd: string | null;
    readonly objective: string;
    readonly source: string;
    readonly supervisor: GlobalSupervisorQualifiedChatRef;
  }) => Promise<{
    readonly chat: GlobalSupervisorQualifiedChatRef;
    readonly commandId: string;
    readonly delivery: "durablyQueued";
  }>;
  readonly unfollowChat: (
    supervisor: GlobalSupervisorQualifiedChatRef,
    target: GlobalSupervisorQualifiedChatRef,
  ) => Promise<void>;
};

export type GlobalSupervisorSystemRequest = {
  readonly connectionId: string;
  readonly params: unknown;
  readonly requestId: string | number;
  readonly supervisor?: GlobalSupervisorQualifiedChatRef;
};

export type GlobalSupervisorToolFailureKind =
  | "invalidOrUnsupportedToolCall"
  | "requestNotAdmitted"
  | "toolExecutionFailed";

type ParsedToolCall =
  | {
      readonly arguments: {
        readonly connectionId: string;
        readonly cwd: string | null;
        readonly objective: string;
      };
      readonly tool: "startTask";
    }
  | { readonly arguments: Record<never, never>; readonly tool: "listActiveWork" }
  | {
      readonly arguments: {
        readonly connectionId: string | null;
        readonly project: string | null;
        readonly title: string | null;
        readonly topic: string | null;
      };
      readonly tool: "findChat";
    }
  | {
      readonly arguments: { readonly cursor: string | null };
      readonly tool: "listChats";
    }
  | {
      readonly arguments: {
        readonly cursor: string | null;
        readonly target: GlobalSupervisorQualifiedChatRef;
      };
      readonly tool: "readChat";
    }
  | {
      readonly arguments: { readonly target: GlobalSupervisorQualifiedChatRef };
      readonly tool: "inspectChat";
    }
  | {
      readonly arguments: { readonly target: GlobalSupervisorQualifiedChatRef };
      readonly tool: "listChatAttachments";
    }
  | {
      readonly arguments: {
        readonly attachmentId: string;
        readonly offset: number;
        readonly target: GlobalSupervisorQualifiedChatRef;
      };
      readonly tool: "readChatAttachment";
    }
  | {
      readonly arguments: { readonly target: GlobalSupervisorQualifiedChatRef };
      readonly tool: "interruptChat";
    }
  | {
      readonly arguments: {
        readonly answer: GlobalSupervisorRequestAnswer;
        readonly eventId: string;
        readonly target: GlobalSupervisorQualifiedChatRef;
      };
      readonly tool: "respondToRequest";
    }
  | {
      readonly arguments: {
        readonly durationMinutes: number | null;
        readonly mode: "active" | "muted" | "snoozed";
        readonly target: GlobalSupervisorQualifiedChatRef;
      };
      readonly tool: "setSpokenAttention";
    }
  | {
      readonly arguments: {
        readonly target: GlobalSupervisorQualifiedChatRef;
        readonly text: string;
      };
      readonly tool: "sendText";
    }
  | {
      readonly arguments: { readonly target: GlobalSupervisorQualifiedChatRef };
      readonly tool: "followChat" | "unfollowChat";
    };

function hasClosedKeys(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function optionalCursor(value: unknown): string | null | undefined {
  return value === null || value === undefined
    ? null
    : typeof value === "string"
      ? value
      : undefined;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalNonEmptyString(value: unknown): string | null | undefined {
  return value === null || value === undefined ? null : (nonEmptyString(value) ?? undefined);
}

function parseStartTaskCall(
  argumentsValue: Readonly<Record<string, unknown>>,
): Extract<ParsedToolCall, { readonly tool: "startTask" }> | null {
  if (!hasClosedKeys(argumentsValue, ["connectionId", "objective"], ["cwd"])) {
    return null;
  }
  const connectionId = nonEmptyString(argumentsValue.connectionId);
  const cwd = optionalNonEmptyString(argumentsValue.cwd);
  const objective = nonEmptyString(argumentsValue.objective);
  return connectionId === null || cwd === undefined || objective === null
    ? null
    : { arguments: { connectionId, cwd, objective }, tool: "startTask" };
}

function parseListActiveWorkCall(
  argumentsValue: Readonly<Record<string, unknown>>,
): Extract<ParsedToolCall, { readonly tool: "listActiveWork" }> | null {
  return hasClosedKeys(argumentsValue, []) ? { arguments: {}, tool: "listActiveWork" } : null;
}

type FindChatArguments = Extract<ParsedToolCall, { readonly tool: "findChat" }>["arguments"];

function findChatArguments(value: Readonly<Record<string, unknown>>): FindChatArguments | null {
  const connectionId = optionalNonEmptyString(value.connectionId);
  const project = optionalNonEmptyString(value.project);
  const title = optionalNonEmptyString(value.title);
  const topic = optionalNonEmptyString(value.topic);
  if ([connectionId, project, title, topic].some((candidate) => candidate === undefined)) {
    return null;
  }
  return {
    connectionId: connectionId ?? null,
    project: project ?? null,
    title: title ?? null,
    topic: topic ?? null,
  };
}

function hasFindChatQuery(value: FindChatArguments): boolean {
  return value.project !== null || value.title !== null || value.topic !== null;
}

function parseFindChatCall(
  argumentsValue: Readonly<Record<string, unknown>>,
): Extract<ParsedToolCall, { readonly tool: "findChat" }> | null {
  if (!hasClosedKeys(argumentsValue, [], ["connectionId", "project", "title", "topic"])) {
    return null;
  }
  const parsed = findChatArguments(argumentsValue);
  if (parsed === null || !hasFindChatQuery(parsed)) {
    return null;
  }
  return { arguments: parsed, tool: "findChat" };
}

function parseRelationCall(
  argumentsValue: Readonly<Record<string, unknown>>,
  tool: "followChat" | "unfollowChat",
): Extract<ParsedToolCall, { readonly tool: "followChat" | "unfollowChat" }> | null {
  if (!hasClosedKeys(argumentsValue, ["connectionId", "threadId"])) {
    return null;
  }
  const target = parseGlobalSupervisorQualifiedChatRef(argumentsValue);
  return target === null ? null : { arguments: { target }, tool };
}

function parseListChatsCall(
  argumentsValue: Readonly<Record<string, unknown>>,
): Extract<ParsedToolCall, { readonly tool: "listChats" }> | null {
  if (!hasClosedKeys(argumentsValue, [], ["cursor"])) {
    return null;
  }
  const cursor = optionalCursor(argumentsValue.cursor);
  return cursor === undefined ? null : { arguments: { cursor }, tool: "listChats" };
}

function parseReadChatCall(
  argumentsValue: Readonly<Record<string, unknown>>,
): Extract<ParsedToolCall, { readonly tool: "readChat" }> | null {
  if (!hasClosedKeys(argumentsValue, ["connectionId", "threadId"], ["cursor"])) {
    return null;
  }
  const cursor = optionalCursor(argumentsValue.cursor);
  const target = parseGlobalSupervisorQualifiedChatRef(argumentsValue);
  return cursor === undefined || target === null
    ? null
    : { arguments: { cursor, target }, tool: "readChat" };
}

function parseInspectChatCall(
  argumentsValue: Readonly<Record<string, unknown>>,
): Extract<ParsedToolCall, { readonly tool: "inspectChat" }> | null {
  if (!hasClosedKeys(argumentsValue, ["connectionId", "threadId"])) {
    return null;
  }
  const target = parseGlobalSupervisorQualifiedChatRef(argumentsValue);
  return target === null ? null : { arguments: { target }, tool: "inspectChat" };
}

function parseTargetCall(
  argumentsValue: Readonly<Record<string, unknown>>,
  tool: "interruptChat" | "listChatAttachments",
): Extract<ParsedToolCall, { readonly tool: "interruptChat" | "listChatAttachments" }> | null {
  if (!hasClosedKeys(argumentsValue, ["connectionId", "threadId"])) {
    return null;
  }
  const target = parseGlobalSupervisorQualifiedChatRef(argumentsValue);
  return target === null ? null : { arguments: { target }, tool };
}

function parseReadChatAttachmentCall(
  argumentsValue: Readonly<Record<string, unknown>>,
): Extract<ParsedToolCall, { readonly tool: "readChatAttachment" }> | null {
  if (!hasClosedKeys(argumentsValue, ["attachmentId", "connectionId", "threadId"], ["offset"])) {
    return null;
  }
  const target = parseGlobalSupervisorQualifiedChatRef(argumentsValue);
  const offset = chatAttachmentOffset(argumentsValue.offset);
  if (
    target === null ||
    !isGlobalSupervisorAttachmentId(argumentsValue.attachmentId) ||
    offset === null
  ) {
    return null;
  }
  return {
    arguments: { attachmentId: argumentsValue.attachmentId, offset, target },
    tool: "readChatAttachment",
  };
}

function chatAttachmentOffset(value: unknown): number | null {
  const offset = value ?? 0;
  return typeof offset === "number" &&
    Number.isSafeInteger(offset) &&
    offset >= 0 &&
    offset < globalSupervisorAttachmentLimits.textTotalMaxBytes
    ? offset
    : null;
}

function parseApprovalAnswer(
  answer: Readonly<Record<string, unknown>>,
): Extract<GlobalSupervisorRequestAnswer, { readonly kind: "approval" }> | null {
  if (!hasClosedKeys(answer, ["decision", "kind"])) {
    return null;
  }
  return answer.decision === "accept" ||
    answer.decision === "acceptForSession" ||
    answer.decision === "decline"
    ? { decision: answer.decision, kind: "approval" }
    : null;
}

function parsePermissionsAnswer(
  answer: Readonly<Record<string, unknown>>,
): Extract<GlobalSupervisorRequestAnswer, { readonly kind: "permissions" }> | null {
  if (!hasClosedKeys(answer, ["decision", "kind"])) {
    return null;
  }
  return answer.decision === "allowSession" ||
    answer.decision === "allowTurn" ||
    answer.decision === "decline"
    ? { decision: answer.decision, kind: "permissions" }
    : null;
}

function parseUserInputAnswer(
  answer: Readonly<Record<string, unknown>>,
): Extract<GlobalSupervisorRequestAnswer, { readonly kind: "userInput" }> | null {
  if (!hasClosedKeys(answer, ["answers", "kind"]) || !Array.isArray(answer.answers)) {
    return null;
  }
  const answers: { readonly answer: string; readonly questionId: string }[] = [];
  for (const value of answer.answers) {
    const row = unknownRecord(value);
    if (row === null || !hasClosedKeys(row, ["answer", "questionId"])) {
      return null;
    }
    const response = nonEmptyString(row.answer);
    const questionId = nonEmptyString(row.questionId);
    if (response === null || questionId === null) {
      return null;
    }
    answers.push({ answer: response, questionId });
  }
  return { answers, kind: "userInput" };
}

function parseElicitationAnswer(
  answer: Readonly<Record<string, unknown>>,
): Extract<GlobalSupervisorRequestAnswer, { readonly kind: "elicitation" }> | null {
  if (!hasClosedKeys(answer, ["action", "kind"], ["content"])) {
    return null;
  }
  if (answer.action !== "accept" && answer.action !== "decline") {
    return null;
  }
  if (answer.content === null || answer.content === undefined) {
    return { action: answer.action, content: null, kind: "elicitation" };
  }
  const content = unknownRecord(answer.content);
  return content === null ? null : { action: answer.action, content, kind: "elicitation" };
}

function parseRequestAnswer(value: unknown): GlobalSupervisorRequestAnswer | null {
  const answer = unknownRecord(value);
  if (answer === null) {
    return null;
  }
  switch (answer.kind) {
    case "approval":
      return parseApprovalAnswer(answer);
    case "permissions":
      return parsePermissionsAnswer(answer);
    case "userInput":
      return parseUserInputAnswer(answer);
    case "elicitation":
      return parseElicitationAnswer(answer);
    default:
      return null;
  }
}

function parseRespondToRequestCall(
  argumentsValue: Readonly<Record<string, unknown>>,
): Extract<ParsedToolCall, { readonly tool: "respondToRequest" }> | null {
  if (!hasClosedKeys(argumentsValue, ["answer", "connectionId", "eventId", "threadId"])) {
    return null;
  }
  const target = parseGlobalSupervisorQualifiedChatRef(argumentsValue);
  const eventId = nonEmptyString(argumentsValue.eventId);
  const answer = parseRequestAnswer(argumentsValue.answer);
  return target === null || eventId === null || answer === null
    ? null
    : { arguments: { answer, eventId, target }, tool: "respondToRequest" };
}

function parseSetSpokenAttentionCall(
  argumentsValue: Readonly<Record<string, unknown>>,
): Extract<ParsedToolCall, { readonly tool: "setSpokenAttention" }> | null {
  if (!hasClosedKeys(argumentsValue, ["connectionId", "mode", "threadId"], ["durationMinutes"])) {
    return null;
  }
  const target = parseGlobalSupervisorQualifiedChatRef(argumentsValue);
  const mode = spokenAttentionMode(argumentsValue.mode);
  const duration = argumentsValue.durationMinutes;
  if (target === null || mode === null || hasUnexpectedSpokenAttentionDuration(mode, duration)) {
    return null;
  }
  const durationMinutes = spokenAttentionDuration(mode, duration);
  if (durationMinutes === undefined) {
    return null;
  }
  return {
    arguments: { durationMinutes, mode, target },
    tool: "setSpokenAttention",
  };
}

const MAX_SNOOZE_MINUTES = 10_080;

function spokenAttentionMode(value: unknown): "active" | "muted" | "snoozed" | null {
  return value === "active" || value === "muted" || value === "snoozed" ? value : null;
}

function hasUnexpectedSpokenAttentionDuration(
  mode: "active" | "muted" | "snoozed",
  value: unknown,
): boolean {
  return mode !== "snoozed" && value !== undefined && value !== null;
}

function spokenAttentionDuration(
  mode: "active" | "muted" | "snoozed",
  value: unknown,
): number | null | undefined {
  if (mode !== "snoozed") {
    return null;
  }
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= MAX_SNOOZE_MINUTES
    ? value
    : undefined;
}

function parseSendTextCall(
  argumentsValue: Readonly<Record<string, unknown>>,
): Extract<ParsedToolCall, { readonly tool: "sendText" }> | null {
  if (!hasClosedKeys(argumentsValue, ["connectionId", "text", "threadId"])) {
    return null;
  }
  const target = parseGlobalSupervisorQualifiedChatRef(argumentsValue);
  const text = nonEmptyString(argumentsValue.text);
  return target === null || text === null
    ? null
    : { arguments: { target, text }, tool: "sendText" };
}

type ToolEnvelope = {
  readonly arguments: Readonly<Record<string, unknown>>;
  readonly tool: unknown;
};

function validOptionalNamespace(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function parseToolEnvelope(value: unknown): ToolEnvelope | null {
  const params = unknownRecord(value);
  if (
    params === null ||
    !hasClosedKeys(params, ["arguments", "callId", "threadId", "tool", "turnId"], ["namespace"])
  ) {
    return null;
  }
  if (
    nonEmptyString(params.callId) === null ||
    nonEmptyString(params.threadId) === null ||
    nonEmptyString(params.turnId) === null ||
    !validOptionalNamespace(params.namespace)
  ) {
    return null;
  }
  const argumentsValue = unknownRecord(params.arguments);
  return argumentsValue === null ? null : { arguments: argumentsValue, tool: params.tool };
}

function parseToolCall(value: unknown): ParsedToolCall | null {
  const envelope = parseToolEnvelope(value);
  if (envelope === null) {
    return null;
  }
  switch (envelope.tool) {
    case "startTask":
      return parseStartTaskCall(envelope.arguments);
    case "listActiveWork":
      return parseListActiveWorkCall(envelope.arguments);
    case "findChat":
      return parseFindChatCall(envelope.arguments);
    case "followChat":
      return parseRelationCall(envelope.arguments, "followChat");
    case "inspectChat":
      return parseInspectChatCall(envelope.arguments);
    case "interruptChat":
      return parseTargetCall(envelope.arguments, "interruptChat");
    case "listChatAttachments":
      return parseTargetCall(envelope.arguments, "listChatAttachments");
    case "listChats":
      return parseListChatsCall(envelope.arguments);
    case "readChat":
      return parseReadChatCall(envelope.arguments);
    case "readChatAttachment":
      return parseReadChatAttachmentCall(envelope.arguments);
    case "sendText":
      return parseSendTextCall(envelope.arguments);
    case "respondToRequest":
      return parseRespondToRequestCall(envelope.arguments);
    case "setSpokenAttention":
      return parseSetSpokenAttentionCall(envelope.arguments);
    case "unfollowChat":
      return parseRelationCall(envelope.arguments, "unfollowChat");
    default:
      return null;
  }
}

const asciiCodePointMax = 127;
const twoByteCodePointMax = 2047;
const threeByteCodePointMax = 65_535;
const utf8OneByte = 1;
const utf8TwoBytes = 2;
const utf8ThreeBytes = 3;
const utf8FourBytes = 4;

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    bytes +=
      codePoint <= asciiCodePointMax
        ? utf8OneByte
        : codePoint <= twoByteCodePointMax
          ? utf8TwoBytes
          : codePoint <= threeByteCodePointMax
            ? utf8ThreeBytes
            : utf8FourBytes;
  }
  return bytes;
}

function failureResponse(kind: GlobalSupervisorToolFailureKind): unknown {
  return {
    contentItems: [{ text: JSON.stringify({ error: kind }), type: "inputText" }],
    success: false,
  };
}

function response(success: boolean, payload: unknown): unknown {
  let text: string;
  try {
    text = JSON.stringify(payload);
  } catch {
    return failureResponse("toolExecutionFailed");
  }
  if (utf8ByteLength(text) > globalSupervisorLimitsV1.dynamicToolOutputMaxBytes) {
    return failureResponse("toolExecutionFailed");
  }
  return { contentItems: [{ text, type: "inputText" }], success };
}

function validInputSize(value: unknown): boolean {
  try {
    return (
      utf8ByteLength(JSON.stringify(value)) <= globalSupervisorLimitsV1.dynamicToolInputMaxBytes
    );
  } catch {
    return false;
  }
}

type ToolExecutionContext = {
  readonly capabilities: GlobalSupervisorToolCapabilities;
  readonly request: GlobalSupervisorSystemRequest;
  readonly supervisor: GlobalSupervisorQualifiedChatRef;
};

function unreachableToolCall(_call: never): never {
  throw new Error("Global Supervisor tool parser produced an unsupported call");
}

async function executeToolCall(
  context: ToolExecutionContext,
  call: ParsedToolCall,
): Promise<unknown> {
  const { capabilities, request, supervisor } = context;
  switch (call.tool) {
    case "startTask": {
      const source = await capabilities.deriveWorkerCreationSource(request);
      const commandId = await capabilities.deriveTargetSendCommandId(request);
      return capabilities.startTask({
        commandId,
        connectionId: call.arguments.connectionId,
        cwd: call.arguments.cwd,
        objective: call.arguments.objective,
        source,
        supervisor,
      });
    }
    case "listActiveWork":
      return capabilities.listActiveWork(supervisor);
    case "findChat":
      return capabilities.findChat(supervisor, call.arguments);
    case "listChats":
      return capabilities.listChats(
        call.arguments.cursor,
        globalSupervisorLimitsV1.listChatsPageMaxEntries,
      );
    case "inspectChat":
      return capabilities.inspectChat(call.arguments.target);
    case "interruptChat":
      return capabilities.interruptChat(call.arguments.target);
    case "listChatAttachments":
      return capabilities.listChatAttachments(call.arguments.target);
    case "readChat":
      return capabilities.readChat({
        cursor: call.arguments.cursor,
        limit: globalSupervisorLimitsV1.readChatPageMaxItems,
        maxBytes: globalSupervisorLimitsV1.readChatPageMaxBytes,
        target: call.arguments.target,
      });
    case "readChatAttachment":
      return capabilities.readChatAttachment(call.arguments);
    case "followChat":
      capabilities.assertLiveTarget(call.arguments.target);
      await capabilities.followChat(supervisor, call.arguments.target);
      return { followed: true };
    case "sendText": {
      capabilities.assertLiveTarget(call.arguments.target);
      const commandId = await capabilities.deriveTargetSendCommandId(request);
      return {
        commandId: await capabilities.sendText({
          commandId,
          supervisor,
          target: call.arguments.target,
          text: call.arguments.text,
        }),
      };
    }
    case "respondToRequest":
      return capabilities.respondToRequest(call.arguments);
    case "setSpokenAttention": {
      capabilities.assertLiveTarget(call.arguments.target);
      return capabilities.setSpokenAttention({
        durationMinutes: call.arguments.durationMinutes,
        mode: call.arguments.mode,
        supervisor,
        target: call.arguments.target,
      });
    }
    case "unfollowChat":
      await capabilities.unfollowChat(supervisor, call.arguments.target);
      return { automaticObservation: true, followed: false };
    default:
      return unreachableToolCall(call);
  }
}

/** Routes only the closed Global Voice Mode tool set and always settles the server request. */
export function createGlobalSupervisorToolRouter(capabilities: GlobalSupervisorToolCapabilities): {
  readonly fail: (
    request: GlobalSupervisorSystemRequest,
    kind: GlobalSupervisorToolFailureKind,
  ) => Promise<void>;
  readonly handle: (request: GlobalSupervisorSystemRequest) => Promise<void>;
} {
  const settleFailure = async (
    request: GlobalSupervisorSystemRequest,
    kind: GlobalSupervisorToolFailureKind,
  ): Promise<void> => {
    await capabilities.respond({
      connectionId: request.connectionId,
      requestId: request.requestId,
      result: failureResponse(kind),
    });
  };
  return {
    fail: settleFailure,
    async handle(request) {
      const call = validInputSize(request.params) ? parseToolCall(request.params) : null;
      if (call === null || request.supervisor === undefined) {
        await settleFailure(request, "invalidOrUnsupportedToolCall");
        return;
      }
      let result: unknown;
      try {
        result = await executeToolCall(
          { capabilities, request, supervisor: request.supervisor },
          call,
        );
      } catch {
        await settleFailure(request, "toolExecutionFailed");
        return;
      }
      await capabilities.respond({
        connectionId: request.connectionId,
        requestId: request.requestId,
        result: response(true, result),
      });
    },
  };
}
