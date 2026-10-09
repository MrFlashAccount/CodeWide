/**
 * The `codewide-agent` v1 JSON-RPC server over JSONL stdio.
 *
 * - One JSON object per line in both directions. Request ids are echoed
 *   exactly (the companion uses strings such as `"codewide-stdio:12"`).
 * - `initialize` negotiates the protocol; a mismatch is a JSON-RPC error and
 *   the process keeps running. Other operations before `initialize` fail.
 * - Events are written as `{"method":"event","params":AgentEvent}` and are
 *   buffered until the companion's `initialized` notification.
 * - The server never sends JSON-RPC requests.
 */

import type { AgentEvent, InitializeResult, OperationName } from "../protocol.js";
import {
  asAppThreadId,
  asClientMessageId,
  asTurnId,
  capabilityUnsupportedMessage,
  CLAUDE_CAPABILITIES,
  ERROR_CODES,
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  PROVIDER_ID,
  providerDescriptor,
} from "../protocol.js";
import type { ClaudeRuntime } from "../claude/port.js";
import type { Logger } from "../log.js";
import { isRecord } from "../mapping/frames.js";
import { PERMISSION_PROFILES } from "../permissions/profiles.js";
import { ModelCatalog } from "../catalog/models.js";
import type { OperationResult, ThreadService } from "../threads/service.js";
import { isOperation, ParamsError, validateParams } from "./validate.js";

type RpcId = string | number;

const PROBE_INTERVAL_MS = 60_000;

interface RpcErrorBody {
  readonly code: number;
  readonly message: string;
  readonly data: { readonly capability: string | null; readonly provider: string | null } | null;
}

export interface ServerDeps {
  readonly service: ThreadService;
  readonly runtime: ClaudeRuntime;
  readonly logger: Logger;
  readonly write: (line: string) => void;
  readonly version: string;
}

export class RpcServer {
  private initialized = false;
  private negotiated = false;
  private readonly buffered: AgentEvent[] = [];
  private readonly catalog = new ModelCatalog();
  private probing: Promise<void> | null = null;
  private lastProbeAtMs: number | null = null;
  private account: InitializeResult["account"] = null;

  constructor(private readonly deps: ServerDeps) {}

  /** Event sink for the service; buffers until `initialized`. */
  emit(event: AgentEvent): void {
    if (!this.initialized) {
      this.buffered.push(event);
      return;
    }
    this.send({ method: "event", params: event });
  }

  private send(message: unknown): void {
    this.deps.write(`${JSON.stringify(message)}\n`);
  }

  private respond(id: RpcId, result: unknown): void {
    this.send({ id, result });
  }

  private error(id: RpcId | null, error: RpcErrorBody): void {
    this.send({ id, error });
  }

  /** At most one probe per minute: each probe starts a short-lived `claude` process. */
  private refreshProbe(): Promise<void> {
    const now = Date.now();
    if (this.probing === null && this.lastProbeAtMs !== null && now - this.lastProbeAtMs < PROBE_INTERVAL_MS) return Promise.resolve();
    if (this.probing === null) this.lastProbeAtMs = now;
    this.probing ??= this.deps.runtime
      .probe()
      .then((probe) => {
        this.catalog.update(probe.models);
        if (probe.account !== null) this.account = probe.account;
      })
      .catch((error: unknown) => {
        this.deps.logger.log("warn", "claude runtime probe failed", { err: error instanceof Error ? error : new Error(String(error)) });
      })
      .finally(() => {
        this.probing = null;
      });
    return this.probing;
  }

  /** Handles one inbound line. Never throws. */
  async handleLine(line: string): Promise<void> {
    if (line.trim().length === 0) return;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.error(null, { code: -32700, message: "parse error", data: null });
      return;
    }
    if (!isRecord(message) || typeof message["method"] !== "string") {
      this.error(null, { code: ERROR_CODES.invalidRequest, message: "invalid request", data: null });
      return;
    }
    const method = message["method"];
    const id = message["id"];
    if (id === undefined) {
      if (method === "initialized" && this.negotiated) this.onInitialized();
      return;
    }
    if (typeof id !== "string" && !(typeof id === "number" && Number.isSafeInteger(id))) {
      this.error(null, { code: ERROR_CODES.invalidRequest, message: "invalid request id", data: null });
      return;
    }
    if (!isOperation(method)) {
      this.error(id, { code: ERROR_CODES.methodNotFound, message: `unknown method ${method}`, data: null });
      return;
    }
    try {
      await this.dispatch(id, method, message["params"]);
    } catch (error) {
      if (error instanceof ParamsError) {
        this.error(id, { code: ERROR_CODES.invalidParams, message: error.message, data: null });
        return;
      }
      const failure = error instanceof Error ? error : new Error(String(error));
      this.deps.logger.log("error", "operation failed", { method, err: failure });
      this.error(id, { code: ERROR_CODES.internal, message: "internal sidecar error", data: null });
    }
  }

  private onInitialized(): void {
    if (this.initialized) return;
    this.initialized = true;
    for (const event of this.buffered.splice(0)) this.send({ method: "event", params: event });
  }

  private reply<Value>(id: RpcId, result: OperationResult<Value>): void {
    if (result.status === "ok") this.respond(id, result.value);
    else this.error(id, { code: result.code, message: result.message, data: null });
  }

  private async dispatch(id: RpcId, method: OperationName, rawParams: unknown): Promise<void> {
    if (method === "initialize") {
      const params = validateParams("initialize", rawParams);
      if (params.protocol !== PROTOCOL_NAME || params.protocolVersion !== PROTOCOL_VERSION) {
        this.deps.logger.log("error", "agent protocol version mismatch", { requested: params.protocolVersion });
        this.error(id, { code: ERROR_CODES.invalidRequest, message: "agent protocol version mismatch", data: null });
        return;
      }
      await this.refreshProbe();
      this.negotiated = true;
      const result: InitializeResult = {
        protocolVersion: PROTOCOL_VERSION,
        provider: providerDescriptor(this.deps.version),
        capabilities: CLAUDE_CAPABILITIES,
        account: this.account,
      };
      this.respond(id, result);
      return;
    }
    if (!this.negotiated) {
      this.error(id, { code: ERROR_CODES.invalidRequest, message: "initialize first", data: null });
      return;
    }
    const service = this.deps.service;
    switch (method) {
      case "catalog.models": {
        validateParams(method, rawParams);
        if (this.catalog.models.length === 0) await this.refreshProbe();
        this.respond(id, { models: this.catalog.models });
        return;
      }
      case "catalog.permissionProfiles":
        validateParams(method, rawParams);
        this.respond(id, { profiles: PERMISSION_PROFILES });
        return;
      case "thread.create": {
        const params = validateParams(method, rawParams);
        const created = service.create(params.appThreadId, params.cwd, params.settings);
        this.reply(id, created.status === "ok" ? { status: "ok", value: { thread: created.value } } : created);
        return;
      }
      case "thread.read":
        this.reply(id, service.read(validateParams(method, rawParams).appThreadId));
        return;
      case "thread.list":
        this.reply(id, service.list(validateParams(method, rawParams)));
        return;
      case "thread.turns": {
        const params = validateParams(method, rawParams);
        this.reply(id, service.turns(params.appThreadId, params.cursor, params.limit, params.sortDirection, params.itemsView));
        return;
      }
      case "thread.update": {
        const params = validateParams(method, rawParams);
        const updated = service.update(params.appThreadId, params.change);
        this.reply(id, updated.status === "ok" ? { status: "ok", value: { thread: updated.value } } : updated);
        return;
      }
      case "thread.owns":
        this.respond(id, { owned: service.owns(validateParams(method, rawParams).appThreadId) });
        return;
      case "thread.compact":
        this.reply(id, service.compact(validateParams(method, rawParams).appThreadId));
        return;
      case "turn.start": {
        const params = validateParams(method, rawParams);
        this.reply(
          id,
          service.startTurn(
            params.appThreadId,
            params.clientMessageId === null ? null : asClientMessageId(params.clientMessageId),
            params.input,
          ),
        );
        return;
      }
      case "turn.steer": {
        const params = validateParams(method, rawParams);
        this.reply(
          id,
          service.steer(
            params.appThreadId,
            asTurnId(params.expectedTurnId),
            params.clientMessageId === null ? null : asClientMessageId(params.clientMessageId),
            params.input,
          ),
        );
        return;
      }
      case "turn.interrupt": {
        const params = validateParams(method, rawParams);
        this.reply(id, service.interrupt(params.appThreadId, params.turnId === null ? null : asTurnId(params.turnId)));
        return;
      }
      case "request.respond": {
        const params = validateParams(method, rawParams);
        this.reply(id, service.respond(asAppThreadId(params.appThreadId), params.requestId, params.response));
        return;
      }
      case "capability.invoke": {
        const params = validateParams(method, rawParams);
        this.error(id, {
          code: ERROR_CODES.capabilityUnsupported,
          message: capabilityUnsupportedMessage(params.capability),
          data: { capability: params.capability, provider: PROVIDER_ID },
        });
        return;
      }
    }
  }
}
