import {
  parseGlobalSupervisorQualifiedChatRef,
  type GlobalSupervisorQualifiedChatRef,
} from "./globalSupervisorBinding";
import { globalSupervisorLimitsV1 } from "./globalSupervisorLimitsV1";
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
  readonly createChat: (request: {
    readonly connectionId: string;
    readonly cwd: string | null;
    readonly source: string;
    readonly supervisor: GlobalSupervisorQualifiedChatRef;
  }) => Promise<GlobalSupervisorQualifiedChatRef>;
  readonly deriveTargetSendCommandId: (request: {
    readonly connectionId: string;
    readonly requestId: string | number;
  }) => Promise<string>;
  readonly deriveWorkerCreationSource: (request: {
    readonly connectionId: string;
    readonly requestId: string | number;
  }) => Promise<string>;
  readonly followChat: (
    supervisor: GlobalSupervisorQualifiedChatRef,
    target: GlobalSupervisorQualifiedChatRef,
  ) => Promise<void>;
  readonly listChats: (cursor: string | null, limit: number) => Promise<GlobalSupervisorChatPage>;
  readonly readChat: (request: {
    readonly cursor: string | null;
    readonly limit: number;
    readonly maxBytes: number;
    readonly target: GlobalSupervisorQualifiedChatRef;
  }) => Promise<GlobalSupervisorHistoryPage>;
  readonly respond: (request: {
    readonly connectionId: string;
    readonly requestId: string | number;
    readonly result: unknown;
  }) => Promise<void>;
  readonly sendText: (request: {
    readonly commandId: string;
    readonly supervisor: GlobalSupervisorQualifiedChatRef;
    readonly target: GlobalSupervisorQualifiedChatRef;
    readonly text: string;
  }) => Promise<string>;
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
      readonly arguments: { readonly connectionId: string; readonly cwd: string | null };
      readonly tool: "createChat";
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

function parseCreateChatCall(
  argumentsValue: Readonly<Record<string, unknown>>,
): Extract<ParsedToolCall, { readonly tool: "createChat" }> | null {
  if (!hasClosedKeys(argumentsValue, ["connectionId"], ["cwd"])) {
    return null;
  }
  const connectionId = nonEmptyString(argumentsValue.connectionId);
  const cwd = optionalNonEmptyString(argumentsValue.cwd);
  return connectionId === null || cwd === undefined
    ? null
    : { arguments: { connectionId, cwd }, tool: "createChat" };
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
    case "createChat":
      return parseCreateChatCall(envelope.arguments);
    case "followChat":
      return parseRelationCall(envelope.arguments, "followChat");
    case "listChats":
      return parseListChatsCall(envelope.arguments);
    case "readChat":
      return parseReadChatCall(envelope.arguments);
    case "sendText":
      return parseSendTextCall(envelope.arguments);
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
    case "createChat": {
      const source = await capabilities.deriveWorkerCreationSource(request);
      return capabilities.createChat({
        connectionId: call.arguments.connectionId,
        cwd: call.arguments.cwd,
        source,
        supervisor,
      });
    }
    case "listChats":
      return capabilities.listChats(
        call.arguments.cursor,
        globalSupervisorLimitsV1.listChatsPageMaxEntries,
      );
    case "readChat":
      return capabilities.readChat({
        cursor: call.arguments.cursor,
        limit: globalSupervisorLimitsV1.readChatPageMaxItems,
        maxBytes: globalSupervisorLimitsV1.readChatPageMaxBytes,
        target: call.arguments.target,
      });
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
    case "unfollowChat":
      await capabilities.unfollowChat(supervisor, call.arguments.target);
      return { followed: false };
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
