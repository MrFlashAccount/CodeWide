/**
 * The `codewide-agent` v1 JSON-RPC server over JSONL stdio.
 *
 * - One JSON object per line in both directions. Request ids are echoed
 *   exactly (the companion uses strings such as `"codewide-stdio:12"`).
 * - `initialize` negotiates the protocol; a mismatch is a JSON-RPC error and
 *   the process keeps running. Other operations before `initialize` fail.
 * - Events are written as `{"method":"event","params":AgentEvent}` and are
 *   buffered until the companion's `initialized` notification.
 * - The only requests the server sends are provider requests (`tool.call`,
 *   see `providerRequests.ts`); a line without `method` is the companion's
 *   answer to one of them.
 */

import type {
  AccountUpdatedNotification,
  AgentEvent,
  InitializeResult,
  OperationName,
  ProviderAccount,
  ProviderRateLimits,
  RateLimitsUpdatedNotification,
  ToolCallParams,
  ToolCallResult,
  TurnId,
  UserContent,
} from "../protocol.js";
import {
  asClientMessageId,
  asTurnId,
  capabilityUnsupportedMessage,
  CLAUDE_CAPABILITIES,
  ERROR_CODES,
  PROTOCOL_VERSION,
  PROVIDER_ID,
  providerDescriptor,
} from "../protocol.js";
import type { RateLimitReporter } from "../account/rateLimitReporter.js";
import type { ClaudeRuntime } from "../claude/port.js";
import type { Logger } from "../log.js";
import { isRecord } from "../mapping/frames.js";
import { PERMISSION_PROFILES } from "../permissions/profiles.js";
import { ModelCatalog } from "../catalog/models.js";
import type { OperationResult, ThreadService, UserMessage } from "../threads/service.js";
import { ShapeError } from "../validation/checks.js";
import { unreachable } from "../support/unreachable.js";
import { ProviderRequests, type ProviderAnswer } from "./providerRequests.js";
import { isOperation, toolCallResult, validateParams } from "./validate.js";

type RpcId = string | number;

const PARSE_ERROR = -32_700;

interface RpcErrorBody {
  readonly code: number;
  readonly data: { readonly capability: string | null; readonly provider: string | null } | null;
  readonly message: string;
}

/** The body of a JSON-RPC response: a result or an error. */
type Reply = { readonly error: RpcErrorBody } | { readonly result: unknown };

const failure = (code: number, message: string): Reply => ({
  error: { code, data: null, message },
});

const reply = <Value>(result: OperationResult<Value>): Reply =>
  result.status === "ok" ? { result: result.value } : failure(result.code, result.message);

/** `thread.create` / `thread.update` answer `{thread}`. */
const threadReply = <Value>(result: OperationResult<Value>): Reply =>
  result.status === "ok"
    ? { result: { thread: result.value } }
    : failure(result.code, result.message);

const optionalTurnId = (turnId: string | null): TurnId | null =>
  turnId === null ? null : asTurnId(turnId);

interface InboundRequest {
  readonly id: RpcId;
  readonly method: string;
  readonly params: unknown;
  readonly type: "request";
}

/** The companion's answer to a provider request. */
interface InboundResponse {
  readonly answer: Exclude<ProviderAnswer, { readonly status: "aborted" }>;
  readonly id: RpcId;
  readonly type: "response";
}

/** One inbound line, classified. */
type Inbound =
  | InboundRequest
  | InboundResponse
  | { readonly error: RpcErrorBody; readonly type: "invalid" }
  | { readonly method: string; readonly type: "notification" }
  | { readonly type: "ignore" };

const invalid = (code: number, message: string): Inbound => ({
  error: { code, data: null, message },
  type: "invalid",
});

const isRpcId = (id: unknown): id is RpcId =>
  typeof id === "string" || (typeof id === "number" && Number.isSafeInteger(id));

function parseJson(
  line: string,
): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try {
    return { ok: true, value: JSON.parse(line) };
  } catch {
    return { ok: false };
  }
}

/** A message without `method`: an answer to a provider request, when it has an id and a body. */
function parseResponse(message: Readonly<Record<string, unknown>>): Inbound {
  const id = message["id"];
  if (!isRpcId(id)) {
    return invalid(ERROR_CODES.invalidRequest, "invalid request");
  }
  if ("result" in message) {
    return { answer: { result: message["result"], status: "result" }, id, type: "response" };
  }
  const error = message["error"];
  if (isRecord(error)) {
    const text = error["message"];
    return {
      answer: { message: typeof text === "string" ? text : "tool call failed", status: "error" },
      id,
      type: "response",
    };
  }
  return invalid(ERROR_CODES.invalidRequest, "invalid request");
}

function parseInbound(line: string): Inbound {
  if (line.trim().length === 0) {
    return { type: "ignore" };
  }
  const parsed = parseJson(line);
  if (!parsed.ok) {
    return invalid(PARSE_ERROR, "parse error");
  }
  const message = parsed.value;
  if (!isRecord(message)) {
    return invalid(ERROR_CODES.invalidRequest, "invalid request");
  }
  return "method" in message ? parseRequest(message) : parseResponse(message);
}

/** A message with `method`: a request or a notification of the companion. */
function parseRequest(message: Readonly<Record<string, unknown>>): Inbound {
  if (typeof message["method"] !== "string") {
    return invalid(ERROR_CODES.invalidRequest, "invalid request");
  }
  const id = message["id"];
  if (id === undefined) {
    return { method: message["method"], type: "notification" };
  }
  return isRpcId(id)
    ? { id, method: message["method"], params: message["params"], type: "request" }
    : invalid(ERROR_CODES.invalidRequest, "invalid request id");
}

/** The prompt of `turn.start` / `turn.steer` with its client id branded. */
const userMessage = (params: {
  readonly clientMessageId: string | null;
  readonly input: readonly UserContent[];
}): UserMessage => ({
  clientMessageId:
    params.clientMessageId === null ? null : asClientMessageId(params.clientMessageId),
  input: params.input,
});

const PROBE_INTERVAL_MS = 60_000;

const failedToolCall = (text: string): ToolCallResult => ({
  content: [{ text, type: "text" }],
  success: false,
});

/** Text returned to the model for a call the turn's end cancelled. */
export const TOOL_CALL_CANCELLED = "The tool call was cancelled.";

export interface ServerDeps {
  readonly logger: Logger;
  /** Owner of the subscription limits; the server reports its snapshot. */
  readonly rateLimits: Pick<RateLimitReporter, "snapshot" | "usageRead">;
  readonly runtime: ClaudeRuntime;
  readonly service: ThreadService;
  readonly version: string;
  readonly write: (line: string) => void;
}

export class RpcServer {
  private initialized = false;
  private negotiated = false;
  private readonly buffered: AgentEvent[] = [];
  private readonly catalog = new ModelCatalog();
  private probing: Promise<void> | null = null;
  private lastProbeAtMs: number | null = null;
  private account: InitializeResult["account"] = null;
  private readonly providerRequests: ProviderRequests;

  private readonly deps: ServerDeps;

  public constructor(deps: ServerDeps) {
    this.deps = deps;
    this.providerRequests = new ProviderRequests((message) => {
      this.send(message);
    });
  }

  /**
   * Sends `tool.call` to the companion and answers with its result. An error
   * answer, a malformed result and an aborted call become `success: false`.
   */
  public async callTool(params: ToolCallParams, signal: AbortSignal): Promise<ToolCallResult> {
    const answer = await this.providerRequests.request("tool.call", params, signal);
    switch (answer.status) {
      case "aborted":
        return failedToolCall(TOOL_CALL_CANCELLED);
      case "error":
        return failedToolCall(answer.message);
      case "result":
        try {
          return toolCallResult(answer.result, "result");
        } catch (error) {
          const cause = error instanceof Error ? error : new Error(String(error));
          this.deps.logger.log("error", "tool.call answer is malformed", {
            callId: params.callId,
            err: cause,
          });
          return failedToolCall("The tool returned a malformed result.");
        }
      default:
        return unreachable(answer);
    }
  }

  /** Stops waiting for every provider request (stdin closed). */
  public shutdown(): void {
    this.providerRequests.abortAll();
  }

  /** Event sink for the service; buffers until `initialized`. */
  public emit(event: AgentEvent): void {
    if (!this.initialized) {
      this.buffered.push(event);
      return;
    }
    this.send({ method: "event", params: event });
  }

  private send(message: unknown): void {
    this.deps.write(`${JSON.stringify(message)}\n`);
  }

  private error(id: RpcId | null, error: RpcErrorBody): void {
    this.send({ error, id });
  }

  /** At most one probe per minute: each probe starts a short-lived `claude` process. */
  private async refreshProbe(): Promise<void> {
    const now = Date.now();
    if (
      this.probing === null &&
      this.lastProbeAtMs !== null &&
      now - this.lastProbeAtMs < PROBE_INTERVAL_MS
    ) {
      return;
    }
    if (this.probing === null) {
      this.lastProbeAtMs = now;
    }
    this.probing ??= this.deps.runtime
      .probe()
      .then((probe) => {
        this.catalog.update(probe.models);
        if (probe.account !== null) {
          this.updateAccount(probe.account);
        }
        if (probe.usage !== null) {
          this.deps.rateLimits.usageRead(probe.usage);
        }
      })
      .catch((error: unknown) => {
        this.deps.logger.log("warn", "claude runtime probe failed", {
          err: error instanceof Error ? error : new Error(String(error)),
        });
      })
      .finally(() => {
        this.probing = null;
      });
    return this.probing;
  }

  /** Handles one inbound line. Never throws. */
  public async handleLine(line: string): Promise<void> {
    const inbound = parseInbound(line);
    switch (inbound.type) {
      case "ignore":
        return;
      case "invalid":
        this.error(null, inbound.error);
        return;
      case "response":
        if (!this.providerRequests.settle(inbound.id, inbound.answer)) {
          this.deps.logger.log("debug", "answer to no waiting provider request", {
            requestId: String(inbound.id),
          });
        }
        return;
      case "notification":
        if (inbound.method === "initialized" && this.negotiated) {
          this.onInitialized();
        }
        return;
      case "request":
        this.send({ id: inbound.id, ...(await this.answer(inbound)) });
        return;
      default:
        unreachable(inbound);
    }
  }

  /** The reply to one request; operation failures become JSON-RPC errors. */
  private async answer(request: InboundRequest): Promise<Reply> {
    if (!isOperation(request.method)) {
      return failure(ERROR_CODES.methodNotFound, `unknown method ${request.method}`);
    }
    try {
      return await this.dispatch(request.method, request.params);
    } catch (error) {
      if (error instanceof ShapeError) {
        return failure(ERROR_CODES.invalidParams, error.message);
      }
      const cause = error instanceof Error ? error : new Error(String(error));
      this.deps.logger.log("error", "operation failed", { err: cause, method: request.method });
      return failure(ERROR_CODES.internal, "internal host error");
    }
  }

  private onInitialized(): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    for (const event of this.buffered.splice(0)) {
      this.send({ method: "event", params: event });
    }
    const limits = this.deps.rateLimits.snapshot();
    if (limits !== null) {
      this.publishRateLimits(limits);
    }
  }

  /**
   * Sends the full limit snapshot (`rateLimits.updated`) once `initialized`;
   * before that the latest snapshot is sent on `initialized`.
   */
  public publishRateLimits(rateLimits: ProviderRateLimits): void {
    if (!this.initialized) {
      return;
    }
    const notification: RateLimitsUpdatedNotification = {
      method: "rateLimits.updated",
      params: { rateLimits },
    };
    this.send(notification);
  }

  private async initialize(rawParams: unknown): Promise<Reply> {
    const params = validateParams("initialize", rawParams);
    if (params.protocolVersion !== PROTOCOL_VERSION) {
      this.deps.logger.log("error", "agent protocol version mismatch", {
        requested: params.protocolVersion,
      });
      return failure(ERROR_CODES.invalidRequest, "agent protocol version mismatch");
    }
    await this.refreshProbe();
    this.negotiated = true;
    const result: InitializeResult = {
      account: this.account,
      capabilities: CLAUDE_CAPABILITIES,
      protocolVersion: PROTOCOL_VERSION,
      provider: providerDescriptor(this.deps.version),
    };
    return { result };
  }

  private async dispatch(method: OperationName, rawParams: unknown): Promise<Reply> {
    if (method === "initialize") {
      return this.initialize(rawParams);
    }
    if (!this.negotiated) {
      return failure(ERROR_CODES.invalidRequest, "initialize first");
    }
    return this.operation(method, rawParams);
  }

  /**
   * Keeps the latest signed-in state and tells the companion when it changes
   * after `initialized` (`account.updated`); before that, `initialize` carries it.
   */
  private updateAccount(account: ProviderAccount): void {
    const previous = this.account;
    this.account = account;
    if (
      this.initialized &&
      (previous === null ||
        previous.authenticated !== account.authenticated ||
        previous.label !== account.label ||
        previous.accountLabel !== account.accountLabel)
    ) {
      const notification: AccountUpdatedNotification = {
        method: "account.updated",
        params: { account },
      };
      this.send(notification);
    }
  }

  private async models(): Promise<Reply> {
    // A signed-out runtime is probed again (at most once per minute), so a
    // sign-in on the server reaches the companion through `account.updated`.
    if (this.catalog.models.length === 0 || this.account?.authenticated !== true) {
      await this.refreshProbe();
    }
    return { result: { models: this.catalog.models, prices: this.catalog.prices } };
  }

  private async operation(
    method: Exclude<OperationName, "initialize">,
    rawParams: unknown,
  ): Promise<Reply> {
    const service = this.deps.service;
    switch (method) {
      case "catalog.models":
        validateParams(method, rawParams);
        return this.models();
      case "catalog.permissionProfiles":
        validateParams(method, rawParams);
        return { result: { profiles: PERMISSION_PROFILES } };
      case "thread.create": {
        const params = validateParams(method, rawParams);
        const created = service.create(params.appThreadId, params.cwd, params.settings);
        if (created.status === "ok" && params.clientTools !== null) {
          service.useClientTools(created.value.appThreadId, params.clientTools);
        }
        return threadReply(created);
      }
      case "thread.read":
        return reply(await service.read(validateParams(method, rawParams).appThreadId));
      case "thread.list":
        return reply(await service.list(validateParams(method, rawParams)));
      case "thread.turns":
        return reply(await service.turns(validateParams(method, rawParams)));
      case "thread.update": {
        const params = validateParams(method, rawParams);
        return threadReply(await service.update(params.appThreadId, params.change));
      }
      case "thread.owns":
        return {
          result: { owned: await service.owns(validateParams(method, rawParams).appThreadId) },
        };
      case "thread.compact":
        return reply(await service.compact(validateParams(method, rawParams).appThreadId));
      case "turn.start": {
        const params = validateParams(method, rawParams);
        return reply(
          await service.startTurn(params.appThreadId, userMessage(params), params.clientTools),
        );
      }
      case "turn.steer": {
        const params = validateParams(method, rawParams);
        const expected = asTurnId(params.expectedTurnId);
        return reply(await service.steer(params.appThreadId, expected, userMessage(params)));
      }
      case "turn.interrupt": {
        const params = validateParams(method, rawParams);
        return reply(await service.interrupt(params.appThreadId, optionalTurnId(params.turnId)));
      }
      case "request.respond": {
        const params = validateParams(method, rawParams);
        return reply(await service.respond(params.appThreadId, params.requestId, params.response));
      }
      case "nativeSession.list":
        return reply(await service.nativeSessions(validateParams(method, rawParams)));
      case "nativeSession.read":
        return reply(await service.readNativeSession(validateParams(method, rawParams).sessionId));
      case "capability.invoke": {
        const params = validateParams(method, rawParams);
        return {
          error: {
            code: ERROR_CODES.capabilityUnsupported,
            data: { capability: params.capability, provider: PROVIDER_ID },
            message: capabilityUnsupportedMessage(params.capability),
          },
        };
      }
      default:
        return unreachable(method);
    }
  }
}
