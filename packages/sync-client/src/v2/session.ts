import { v2SavedServerId, type V2SavedServerId } from "./canonical";
import type { V2ClientFrame, V2CommandTerminalFrame, V2OpenIntent, V2ServerFrame } from "./frames";
import type { V2Error } from "./model";
import type { V2Action, V2ActionResult, V2Command, V2Query, V2QueryResult } from "./operations";
import type { V2OperationStore } from "./operation-store";
import type { V2ProjectionStore } from "./projection";
import type { V2SocketLike } from "./transport";
import { validateV2ClientFrame } from "./validate-client";
import { parseV2ServerFrame, V2ProtocolValidationError } from "./validate";

export type SyncV2ConnectionState = "offline" | "initializing" | "live" | "reinitializing" | "error";
export type SyncV2SafeDiagnostic = { code: "transport" | "protocol" | "projection" | "reinitialize" | "operation"; detail: string };
export type SyncV2Connection = {
  savedServerId: string;
  endpoint: string;
  tlsPinSha256: string;
  deviceId: string;
};

export type SyncV2SessionOptions = {
  connection: SyncV2Connection;
  intent: V2OpenIntent;
  projectionStore: V2ProjectionStore;
  operationStore: V2OperationStore;
  socketFactory: (connection: SyncV2Connection) => V2SocketLike;
  onState?: (state: SyncV2ConnectionState, diagnostic: SyncV2SafeDiagnostic | null) => void;
  requestId?: () => string;
  reconnectDelayMs?: number;
};

type Pending<T> = { resolve(value: T): void; reject(cause: Error): void; kind: string };
type CommandFrame = Extract<V2ServerFrame, { type: `command${string}` }>;

/** Independent V2 connection epoch with saved-server-partitioned durable state. */
export class SyncV2Session {
  readonly #connection: SyncV2Connection;
  readonly #savedServerId: V2SavedServerId;
  readonly #intent: V2OpenIntent;
  readonly #projectionStore: V2ProjectionStore;
  readonly #operationStore: V2OperationStore;
  readonly #socketFactory: (connection: SyncV2Connection) => V2SocketLike;
  readonly #onState: (state: SyncV2ConnectionState, diagnostic: SyncV2SafeDiagnostic | null) => void;
  readonly #requestId: () => string;
  readonly #reconnectDelayMs: number;
  readonly #queries = new Map<string, Pending<V2QueryResult>>();
  readonly #actions = new Map<string, Pending<V2ActionResult>>();
  readonly #commands = new Map<string, Pending<V2CommandTerminalFrame>>();
  readonly #recoveringOperations = new Set<string>();
  #socket: V2SocketLike | undefined;
  #phase: "offline" | "waitingOpen" | "initializing" | "awaitingCommit" | "draining" | "live" = "offline";
  #epochId: string | null = null;
  #watermark: string | null = null;
  #applyChain = Promise.resolve();
  #commandChain = Promise.resolve();
  #snapshotCommit: AbortController | null = null;
  #stopped = true;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: SyncV2SessionOptions) {
    this.#connection = requireSyncV2AuthenticatedConnection(options.connection);
    this.#savedServerId = v2SavedServerId(options.connection.savedServerId);
    this.#intent = validateIntent(options.intent);
    this.#projectionStore = options.projectionStore;
    this.#operationStore = options.operationStore;
    this.#socketFactory = options.socketFactory;
    this.#onState = options.onState ?? (() => undefined);
    this.#requestId = options.requestId ?? defaultRequestId;
    this.#reconnectDelayMs = options.reconnectDelayMs ?? 1_000;
  }

  get state(): SyncV2ConnectionState {
    if (this.#phase === "live") return "live";
    if (this.#phase === "offline") return "offline";
    return "initializing";
  }

  get savedServerId(): V2SavedServerId {
    return this.#savedServerId;
  }

  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    void this.#operationStore.prune(this.#savedServerId).then(() => this.#connect()).catch(() => {
      this.#onState("error", { code: "projection", detail: "durable_state_failed" });
    });
  }

  stop(): void {
    this.#stopped = true;
    this.#snapshotCommit?.abort();
    this.#snapshotCommit = null;
    if (this.#reconnectTimer !== undefined) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = undefined;
    this.#socket?.close(1000, "client_stopped");
    this.#socket = undefined;
    this.#phase = "offline";
    this.#rejectEphemeral("Sync V2 connection stopped");
    this.#onState("offline", null);
  }

  /** Explicit saved-server deletion is the only lifecycle event that purges this partition. */
  async purgeSavedServerData(): Promise<void> {
    this.stop();
    await Promise.all([
      this.#projectionStore.deleteSavedServer(this.#savedServerId),
      this.#operationStore.deleteSavedServer(this.#savedServerId),
    ]);
  }

  async query(query: V2Query): Promise<V2QueryResult> {
    this.#requireLive();
    const requestId = this.#requestId();
    const frame = validateV2ClientFrame({ type: "query", requestId, query });
    const promise = pendingPromise(this.#queries, requestId, query.kind);
    try {
      this.#send(frame);
    } catch (cause: unknown) {
      this.#queries.delete(requestId);
      throw cause;
    }
    return await promise;
  }

  async command(operationId: string, command: V2Command): Promise<V2CommandTerminalFrame> {
    this.#requireLive();
    let operation = await this.#operationStore.create(this.#savedServerId, operationId, command);
    if (operation.state === "created") {
      operation = await this.#operationStore.transition(this.#savedServerId, operationId, ["created"], { state: "sent" });
    } else if (operation.state !== "sent") {
      throw new Error(`Sync V2 operation ${operationId} is already ${operation.state}; automatic resend is forbidden`);
    }
    const promise = pendingPromise(this.#commands, operationId, operation.commandKind);
    if (!this.#recoveringOperations.has(operationId)) {
      if (operation.command === null) throw new Error("Sync V2 unconfirmed operation payload is unavailable");
      this.#recoveringOperations.add(operationId);
      try {
        this.#sendCommand(operationId, operation.command);
      } catch (cause: unknown) {
        this.#recoveringOperations.delete(operationId);
        this.#commands.delete(operationId);
        throw cause;
      }
    }
    return await promise;
  }

  async action(action: V2Action): Promise<V2ActionResult> {
    this.#requireLive();
    const requestId = this.#requestId();
    const frame = validateV2ClientFrame({ type: "action", requestId, action });
    const promise = pendingPromise(this.#actions, requestId, action.kind);
    try {
      this.#send(frame);
    } catch (cause: unknown) {
      this.#actions.delete(requestId);
      throw cause;
    }
    return await promise;
  }

  #connect(): void {
    if (this.#stopped) return;
    this.#phase = "waitingOpen";
    this.#onState("initializing", null);
    const socket = this.#socketFactory(this.#connection);
    this.#socket = socket;
    socket.addEventListener("open", () => {
      if (this.#socket !== socket || this.#stopped) return;
      this.#beginEpoch();
    });
    socket.addEventListener("message", (event) => {
      if (this.#socket !== socket || this.#stopped) return;
      if (typeof event.data !== "string") {
        socket.close(1003, "binary_frame");
        return;
      }
      let frame: V2ServerFrame;
      try {
        frame = parseV2ServerFrame(event.data);
      } catch (cause: unknown) {
        socket.close(cause instanceof V2ProtocolValidationError && cause.message === "Malformed Sync V2 JSON" ? 1007 : 1008, "invalid_v2_frame");
        this.#onState("error", { code: "protocol", detail: "invalid_v2_frame" });
        return;
      }
      this.#receive(frame);
    });
    socket.addEventListener("error", () => this.#onState("error", { code: "transport", detail: "socket_error" }));
    socket.addEventListener("close", () => this.#handleClose(socket));
  }

  #handleClose(socket: V2SocketLike): void {
    if (this.#socket !== socket) return;
    this.#snapshotCommit?.abort();
    this.#snapshotCommit = null;
    const epochId = this.#epochId;
    this.#socket = undefined;
    this.#phase = "offline";
    this.#epochId = null;
    this.#watermark = null;
    this.#recoveringOperations.clear();
    this.#rejectEphemeral("Sync V2 connection closed; generation-bound requests are never retried");
    this.#onState("offline", null);
    const abandoned = epochId === null ? Promise.resolve(true) : this.#recoverableAbandon(epochId);
    void abandoned.then(() => {
      if (!this.#stopped && this.#socket === undefined) this.#reconnectTimer = setTimeout(() => this.#connect(), this.#reconnectDelayMs);
    });
  }

  #beginEpoch(): void {
    this.#phase = "initializing";
    this.#epochId = null;
    this.#watermark = null;
    this.#send({ type: "open", version: 2, intent: this.#intent });
  }

  #receive(frame: V2ServerFrame): void {
    if (frame.type === "snapshot") return this.#receiveSnapshot(frame);
    if (frame.type === "change") return this.#receiveChange(frame);
    if (frame.type === "live") return this.#receiveLive(frame);
    if (frame.type === "reinitialize") return this.#receiveReinitialize(frame);
    if (frame.type === "queryCompleted" || frame.type === "queryFailed") return settleRequest(this.#queries, frame);
    if (frame.type === "actionCompleted" || frame.type === "actionFailed") return settleRequest(this.#actions, frame);
    if (frame.type.startsWith("command")) {
      this.#commandChain = this.#commandChain.then(() => this.#settleCommand(frame as CommandFrame)).catch(() => this.#protocolFailure("command_lifecycle_failed"));
    }
  }

  #receiveSnapshot(frame: Extract<V2ServerFrame, { type: "snapshot" }>): void {
    if (this.#phase !== "initializing") return this.#protocolFailure("snapshot_out_of_phase");
    if (!validTail(frame.watermark, frame.includedTail.map(({ watermark }) => watermark))) return this.#protocolFailure("invalid_snapshot_tail");
    const controller = new AbortController();
    this.#snapshotCommit = controller;
    this.#phase = "awaitingCommit";
    this.#epochId = frame.epochId;
    this.#watermark = frame.watermark;
    this.#applyChain = this.#applyChain.then(async () => {
      const committed = await this.#projectionStore.commitSnapshot(this.#savedServerId, frame, controller.signal);
      if (committed === null || controller.signal.aborted || this.#epochId !== frame.epochId || this.#phase !== "awaitingCommit") return;
      this.#send({ type: "snapshotCommitted", epochId: frame.epochId, revision: frame.revision, watermark: frame.watermark });
      this.#phase = "draining";
      this.#snapshotCommit = null;
    }).catch(() => {
      if (!controller.signal.aborted) this.#projectionFailure(frame.epochId);
    });
  }

  #receiveChange(frame: Extract<V2ServerFrame, { type: "change" }>): void {
    if (this.#phase !== "draining" && this.#phase !== "live") return this.#protocolFailure("change_out_of_phase");
    if (frame.epochId !== this.#epochId || this.#watermark === null || compareU64(frame.watermark, this.#watermark) <= 0) return this.#protocolFailure("invalid_change_watermark");
    this.#watermark = frame.watermark;
    this.#applyChain = this.#applyChain
      .then(() => this.#projectionStore.applyChange(this.#savedServerId, frame.epochId, frame.watermark, frame.change))
      .catch(() => this.#projectionFailure(frame.epochId));
  }

  #receiveLive(frame: Extract<V2ServerFrame, { type: "live" }>): void {
    if (this.#phase !== "draining" || frame.epochId !== this.#epochId || frame.watermark !== this.#watermark) return this.#protocolFailure("invalid_live_boundary");
    this.#applyChain = this.#applyChain.then(async () => {
      if (this.#epochId !== frame.epochId) return;
      await this.#commandChain;
      if (this.#epochId !== frame.epochId) return;
      this.#phase = "live";
      this.#onState("live", null);
      await this.#recoverUnconfirmedSent();
    }).catch(() => this.#projectionFailure(frame.epochId));
  }

  #receiveReinitialize(frame: Extract<V2ServerFrame, { type: "reinitialize" }>): void {
    const preSnapshot = this.#phase === "initializing" && this.#epochId === null;
    if (!preSnapshot && frame.epochId !== this.#epochId) return this.#protocolFailure("foreign_reinitialize");
    if (!["initializing", "awaitingCommit", "draining", "live"].includes(this.#phase)) return this.#protocolFailure("reinitialize_out_of_phase");
    this.#snapshotCommit?.abort();
    this.#snapshotCommit = null;
    const abandoned = this.#epochId ?? frame.epochId;
    this.#phase = "waitingOpen";
    this.#epochId = null;
    this.#watermark = null;
    this.#recoveringOperations.clear();
    this.#rejectEphemeral("Sync V2 epoch reinitialized; generation-bound requests are never retried");
    this.#onState("reinitializing", { code: "reinitialize", detail: frame.reason });
    void this.#recoverableAbandon(abandoned).then((succeeded) => {
      if (succeeded && this.#phase === "waitingOpen" && this.#socket !== undefined) this.#beginEpoch();
      else if (!succeeded && this.#phase === "waitingOpen") this.#socket?.close(1011, "durable_abandon_failed");
    });
  }

  #recoverableAbandon(epochId: string): Promise<boolean> {
    const attempt = this.#applyChain.then(() => this.#projectionStore.abandonEpoch(this.#savedServerId, epochId));
    const recovered = attempt.then(
      () => true,
      () => {
        this.#onState("error", { code: "projection", detail: "durable_abandon_failed" });
        return false;
      },
    );
    this.#applyChain = recovered.then(() => undefined);
    return recovered;
  }

  async #settleCommand(frame: CommandFrame): Promise<void> {
    const operation = await this.#operationStore.get(this.#savedServerId, frame.operationId);
    if (operation === null) return this.#protocolFailure("missing_command_operation");
    if (frame.type === "commandAccepted") {
      if (operation.state === "sent") {
        await this.#operationStore.transition(this.#savedServerId, frame.operationId, ["sent"], { state: "accepted", acceptedAt: frame.acceptedAt });
      } else if (operation.state !== "accepted") {
        return this.#protocolFailure("command_acceptance_out_of_phase");
      }
      return;
    }
    const preAdmissionTerminal = frame.type === "commandRejected" || frame.type === "commandExpired";
    const expected = preAdmissionTerminal ? ["sent"] as const : ["accepted"] as const;
    if (!expected.includes(operation.state as never)) return this.#protocolFailure("command_terminal_out_of_phase");
    if (frame.type === "commandCompleted" && frame.result.kind !== operation.commandKind) return this.#protocolFailure("command_result_kind_mismatch");
    const state = commandTerminalState(frame);
    await this.#operationStore.transition(this.#savedServerId, frame.operationId, expected, { state });
    this.#recoveringOperations.delete(frame.operationId);
    const pending = this.#commands.get(frame.operationId);
    if (pending !== undefined) {
      this.#commands.delete(frame.operationId);
      pending.resolve(frame);
    }
  }

  async #recoverUnconfirmedSent(): Promise<void> {
    for (const operation of await this.#operationStore.recoverable(this.#savedServerId)) {
      if (this.#phase !== "live" || operation.command === null || this.#recoveringOperations.has(operation.operationId)) continue;
      this.#recoveringOperations.add(operation.operationId);
      this.#sendCommand(operation.operationId, operation.command);
    }
  }

  #sendCommand(operationId: string, command: V2Command): void {
    this.#send({ type: "command", requestId: this.#requestId(), operationId, command });
  }

  #requireLive(): void {
    if (this.#phase !== "live" || this.#socket === undefined) throw new Error("Sync V2 connection is not live");
  }

  #send(frame: V2ClientFrame): void {
    if (this.#socket === undefined) throw new Error("Sync V2 socket is unavailable");
    this.#socket.send(JSON.stringify(validateV2ClientFrame(frame)));
  }

  #protocolFailure(detail: string): void {
    this.#onState("error", { code: "protocol", detail });
    this.#socket?.close(1008, detail);
  }

  #projectionFailure(epochId: string): void {
    if (this.#epochId !== epochId) return;
    this.#onState("error", { code: "projection", detail: "atomic_projection_failed" });
    this.#socket?.close(1011, "atomic_projection_failed");
  }

  #rejectEphemeral(message: string): void {
    const error = new Error(message);
    for (const pending of [...this.#queries.values(), ...this.#actions.values(), ...this.#commands.values()]) pending.reject(error);
    this.#queries.clear();
    this.#actions.clear();
    this.#commands.clear();
  }
}

export class SyncV2RequestError extends Error {
  constructor(readonly detail: V2Error) { super(detail.message); }
}

export function requireSyncV2Endpoint(endpoint: string): string {
  const url = new URL(endpoint);
  if ((url.protocol !== "ws:" && url.protocol !== "wss:") || url.pathname !== "/v2/sync" || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") throw new Error("Sync V2 endpoint must be an explicit ws:// or wss:// URL ending in /v2/sync");
  return url.toString();
}

export function requireSyncV2AuthenticatedConnection(connection: SyncV2Connection): SyncV2Connection {
  const endpoint = requireSyncV2Endpoint(connection.endpoint);
  if (!/^sha256\/[A-Za-z0-9+/]{43}=$/u.test(connection.tlsPinSha256)) {
    throw new Error("Sync V2 transport requires a pinned Companion TLS identity");
  }
  if (!/^device-[a-f0-9]{64}$/u.test(connection.deviceId)) {
    throw new Error("Sync V2 transport requires the authoritative paired device id");
  }
  return { ...connection, endpoint };
}

function validateIntent(intent: V2OpenIntent): V2OpenIntent {
  validateV2ClientFrame({ type: "open", version: 2, intent });
  return structuredClone(intent);
}

function defaultRequestId(): string { return crypto.randomUUID(); }
function compareU64(left: string, right: string): number { return left.length === right.length ? left.localeCompare(right) : left.length - right.length; }
function validTail(snapshotWatermark: string, tail: string[]): boolean { return tail.every((value, index) => index === 0 || compareU64(value, tail[index - 1]!) > 0) && (tail.at(-1) ?? "0") === snapshotWatermark; }

function commandTerminalState(frame: V2CommandTerminalFrame): "completed" | "failed" | "indeterminate" | "rejected" | "expired" {
  if (frame.type === "commandCompleted") return "completed";
  if (frame.type === "commandFailed") return "failed";
  if (frame.type === "commandIndeterminate") return "indeterminate";
  return frame.type === "commandRejected" ? "rejected" : "expired";
}

function pendingPromise<T>(map: Map<string, Pending<T>>, key: string, kind: string): Promise<T> {
  if (map.has(key)) throw new Error(`Duplicate Sync V2 request ${key}`);
  return new Promise<T>((resolve, reject) => map.set(key, { resolve, reject, kind }));
}

function settleRequest<T extends V2QueryResult | V2ActionResult>(map: Map<string, Pending<T>>, frame: { requestId: string; result?: T; error?: V2Error }): void {
  const pending = map.get(frame.requestId);
  if (pending === undefined) return;
  map.delete(frame.requestId);
  if (frame.error !== undefined) pending.reject(new SyncV2RequestError(frame.error));
  else if (frame.result !== undefined && frame.result.kind === pending.kind) pending.resolve(frame.result);
  else pending.reject(new Error("Sync V2 result kind does not match its request"));
}
