import { fingerprintV2Command, v2SavedServerId, type V2SavedServerId } from "./canonical";
import type { V2ClientFrame, V2CommandTerminalFrame, V2OpenIntent, V2ServerFrame } from "./frames";
import type {
  V2Command,
  V2OperationStatus,
  V2PersistedOperation,
  V2Query,
  V2QueryResult,
} from "./operations";
import type { V2ProjectionChange } from "./model";
import type { V2OperationStore } from "./operation-store";
import type { V2ProjectionStore, V2ProjectionViews, V2StoreUnsubscribe } from "./projection";
import type { SyncV2TransportLease, V2SocketLike } from "./transport";
import { validateV2ClientFrame } from "./validate-client";
import { parseV2ServerFrame, V2ProtocolValidationError } from "./validate";
import {
  commandPending,
  commandTerminalState,
  compareU64,
  defaultRequestId,
  isRetryableOperationReceiptFailure,
  pendingPromise,
  sameIntent,
  settleRequest,
  SyncV2RequestError,
  SyncV2CommandDurableUnsettledError,
  SyncV2CommandNotCreatedError,
  type Pending,
  validateIntent,
  validTail,
} from "./session-support";

export {
  SyncV2CommandDurableUnsettledError,
  SyncV2CommandNotCreatedError,
  SyncV2RequestError,
} from "./session-support";

export type SyncV2ConnectionState =
  | "offline"
  | "initializing"
  | "live"
  | "reinitializing"
  | "error";
export type SyncV2SafeDiagnostic = {
  code: "transport" | "protocol" | "projection" | "reinitialize" | "operation";
  detail: string;
};

const MAX_OPERATION_RECEIPT_RECOVERY_FAILURES = 5;
const MAX_OPERATION_RECEIPT_RETRY_DELAY_MS = 30_000;
export type SyncV2SessionSnapshot = {
  version: number;
  state: SyncV2ConnectionState;
  projections: V2ProjectionViews;
  operations: V2OperationStatus[];
};

export type SyncV2SessionOptions = {
  savedServerId: string;
  transportLease: SyncV2TransportLease;
  intent: V2OpenIntent;
  projectionStore: V2ProjectionStore;
  operationStore: V2OperationStore;
  onState?: (state: SyncV2ConnectionState, diagnostic: SyncV2SafeDiagnostic | null) => void;
  requestId?: () => string;
  reconnectDelayMs?: number;
  requestTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  initializationTimeoutMs?: number;
};

type CommandFrame = Extract<V2ServerFrame, { type: `command${string}` }>;
type LiveAuthority = { socket: V2SocketLike; epochId: string };

/** Independent V2 connection epoch with saved-server-partitioned durable state. */
export class SyncV2Session {
  readonly #savedServerId: V2SavedServerId;
  #intent: V2OpenIntent;
  readonly #projectionStore: V2ProjectionStore;
  readonly #operationStore: V2OperationStore;
  readonly #transportLease: SyncV2TransportLease;
  readonly #onState: (
    state: SyncV2ConnectionState,
    diagnostic: SyncV2SafeDiagnostic | null,
  ) => void;
  readonly #requestId: () => string;
  readonly #reconnectDelayMs: number;
  readonly #requestTimeoutMs: number;
  readonly #heartbeatIntervalMs: number;
  readonly #heartbeatTimeoutMs: number;
  readonly #initializationTimeoutMs: number;
  readonly #queries = new Map<string, Pending<V2QueryResult>>();
  readonly #threadWatches = new Map<string, Pending<void>>();
  readonly #threadWatchTargets = new Map<string, string>();
  readonly #commands = new Map<string, Pending<V2CommandTerminalFrame>>();
  readonly #recoveringOperations = new Set<string>();
  readonly #operationReceiptFailures = new Map<string, number>();
  readonly #observers = new Set<() => void>();
  readonly #changeObservers = new Set<(change: V2ProjectionChange) => void>();
  readonly #requestTimers = new Map<string, ReturnType<typeof setTimeout>>();
  #diagnostic: SyncV2SafeDiagnostic | null = null;
  #socket: V2SocketLike | undefined;
  #phase: "offline" | "waitingOpen" | "initializing" | "awaitingCommit" | "draining" | "live" =
    "offline";
  #epochId: string | null = null;
  #watermark: string | null = null;
  #applyChain = Promise.resolve();
  #commandChain = Promise.resolve();
  #snapshotCommit: AbortController | null = null;
  #stopped = true;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  #heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  #heartbeatDeadlineTimer: ReturnType<typeof setTimeout> | undefined;
  #pendingHeartbeatNonce: string | null = null;
  #initializationDeadlineTimer: ReturnType<typeof setTimeout> | undefined;
  #storeUnsubscribes: V2StoreUnsubscribe[] = [];
  #publicationVersion = 0;
  #connectionState: SyncV2ConnectionState = "offline";

  constructor(options: SyncV2SessionOptions) {
    this.#savedServerId = v2SavedServerId(options.savedServerId);
    this.#intent = validateIntent(options.intent);
    this.#projectionStore = options.projectionStore;
    this.#operationStore = options.operationStore;
    this.#transportLease = options.transportLease;
    this.#onState = options.onState ?? (() => undefined);
    this.#requestId = options.requestId ?? defaultRequestId;
    this.#reconnectDelayMs = options.reconnectDelayMs ?? 1_000;
    this.#requestTimeoutMs = positiveDuration(options.requestTimeoutMs, 15_000);
    this.#heartbeatIntervalMs = positiveDuration(options.heartbeatIntervalMs, 5_000);
    this.#heartbeatTimeoutMs = positiveDuration(options.heartbeatTimeoutMs, 10_000);
    this.#initializationTimeoutMs = positiveDuration(options.initializationTimeoutMs, 15_000);
    this.#observeStores();
  }

  get state(): SyncV2ConnectionState {
    return this.#connectionState;
  }

  get savedServerId(): V2SavedServerId {
    return this.#savedServerId;
  }

  /** Reads both authoritative projection views without inferring liveness from retained data. */
  async projectionViews(): Promise<V2ProjectionViews> {
    const retained = await this.#projectionStore.retained(this.#savedServerId);
    if (this.state !== "live") return { live: null, retained };
    const live = await this.#projectionStore.active(this.#savedServerId);
    return { live: this.state === "live" ? live : null, retained };
  }

  /** Reads the complete content-free operation status surface for this saved server. */
  async operations(): Promise<V2OperationStatus[]> {
    return await this.#operationStore.list(this.#savedServerId);
  }

  /** Reads a coherent consumer-facing view; the stores remain the state-machine owners. */
  async snapshot(): Promise<SyncV2SessionSnapshot> {
    for (;;) {
      const version = this.#publicationVersion;
      const state = this.state;
      const [projections, operations] = await Promise.all([
        this.projectionViews(),
        this.operations(),
      ]);
      if (version === this.#publicationVersion && state === this.state) {
        return { version, state, projections, operations };
      }
    }
  }

  /** Observes connection, projection, and operation publication boundaries. */
  subscribe(listener: () => void): V2StoreUnsubscribe {
    this.#observers.add(listener);
    return () => {
      this.#observers.delete(listener);
    };
  }

  /** Observes accepted semantic deltas without turning every publication into a refetch. */
  subscribeChange(listener: (change: V2ProjectionChange) => void): V2StoreUnsubscribe {
    this.#changeObservers.add(listener);
    return () => {
      this.#changeObservers.delete(listener);
    };
  }

  /** Returns the bounded diagnostic attached to the current connection state. */
  safeDiagnostic(): SyncV2SafeDiagnostic | null {
    return this.#diagnostic;
  }

  start(): void {
    if (!this.#stopped) return;
    this.#observeStores();
    this.#stopped = false;
    void this.#operationStore
      .prune(this.#savedServerId)
      .then(() => this.#connect())
      .catch(() => {
        this.#setState("error", { code: "projection", detail: "durable_state_failed" });
      });
  }

  /** Replaces only this session's transport epoch while preserving durable command waiters. */
  reconnect(): void {
    if (this.#stopped) {
      this.start();
      return;
    }
    if (this.#reconnectTimer !== undefined) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = undefined;
    if (this.#socket === undefined) {
      this.#connect();
      return;
    }
    this.#socket.close(1012, "client_reconnect");
  }

  /** Reopens this saved-server authority with a new projection intent. */
  updateIntent(intent: V2OpenIntent): void {
    const next = validateIntent(intent);
    if (sameIntent(this.#intent, next)) return;
    this.#intent = next;
    if (!this.#stopped) this.reconnect();
  }

  stop(): void {
    this.#stopped = true;
    this.#snapshotCommit?.abort();
    this.#snapshotCommit = null;
    if (this.#reconnectTimer !== undefined) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = undefined;
    this.#stopHeartbeat();
    this.#stopInitializationDeadline();
    this.#socket?.close(1000, "client_stopped");
    this.#socket = undefined;
    this.#phase = "offline";
    this.#rejectEphemeral("Sync V2 connection stopped");
    this.#rejectDurableCommands();
    this.#setState("offline", null);
    for (const unsubscribe of this.#storeUnsubscribes) unsubscribe();
    this.#storeUnsubscribes = [];
  }

  /** Stops new work and waits until already-started projection/command work releases its stores. */
  async dispose(): Promise<void> {
    if (!this.#stopped) {
      this.#stopped = true;
      this.#snapshotCommit?.abort();
      this.#snapshotCommit = null;
      if (this.#reconnectTimer !== undefined) clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = undefined;
      this.#stopHeartbeat();
      this.#stopInitializationDeadline();
      const socket = this.#socket;
      this.#socket = undefined;
      socket?.close(1000, "client_disposed");
      this.#rejectEphemeral("Sync V2 connection disposed");
      this.#rejectDurableCommands();
      for (const unsubscribe of this.#storeUnsubscribes) unsubscribe();
      this.#storeUnsubscribes = [];
    }
    // Command settlement can enqueue authoritative projection cleanup. Drain it first,
    // then read the final apply chain so a replacement session never overlaps that cleanup.
    await this.#commandChain;
    await this.#applyChain;
    this.#phase = "offline";
    this.#epochId = null;
    this.#watermark = null;
    this.#setState("offline", null);
  }

  /** Explicit saved-server deletion is the only lifecycle event that purges this partition. */
  async purgeSavedServerData(): Promise<void> {
    await this.dispose();
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
    this.#armRequestTimeout(this.#queries, requestId, "query_timeout");
    try {
      this.#send(frame);
    } catch (cause: unknown) {
      this.#deletePending(this.#queries, requestId);
      throw cause;
    }
    return await promise;
  }

  /** Changes the live thread subscription without replacing the transport epoch. */
  async watchThread(threadId: string, turnLimit: number): Promise<void> {
    const previousIntent = this.#intent;
    const nextIntent = validateIntent({
      catalog: this.#intent.catalog,
      currentThread: { threadId, turnLimit },
      pendingRequests: this.#intent.pendingRequests,
    });
    this.#intent = nextIntent;
    const requestId = this.#requestId();
    const frame = validateV2ClientFrame({ type: "threadWatch", requestId, threadId, turnLimit });
    const promise = pendingPromise(this.#threadWatches, requestId, "threadWatch");
    this.#threadWatchTargets.set(requestId, threadId);
    this.#armRequestTimeout(this.#threadWatches, requestId, "thread_watch_timeout", () => {
      this.#threadWatchTargets.delete(requestId);
    });
    try {
      await Promise.race([this.#whenLive(), promise]);
      if (!this.#threadWatches.has(requestId)) return await promise;
      this.#send(frame);
    } catch (cause: unknown) {
      this.#deleteThreadWatch(requestId);
      if (cause instanceof SyncV2RequestError && sameIntent(this.#intent, nextIntent))
        this.#intent = previousIntent;
      throw cause;
    }
    await promise;
  }

  async #whenLive(): Promise<void> {
    if (this.#stopped) throw new Error("Sync V2 connection is stopped");
    if (this.#connectionState === "live" && this.#phase === "live") return;
    await new Promise<void>((resolve, reject) => {
      const unsubscribe = this.subscribe(() => {
        if (this.#connectionState === "live" && this.#phase === "live") {
          unsubscribe();
          resolve();
        } else if (this.#stopped || this.#connectionState === "error") {
          unsubscribe();
          reject(new Error("Sync V2 connection became unavailable before thread watch"));
        }
      });
    });
  }

  async command(operationId: string, command: V2Command): Promise<V2CommandTerminalFrame> {
    try {
      validateV2ClientFrame({
        type: "command",
        requestId: "command-validation",
        operationId,
        command,
      });
      fingerprintV2Command(command);
    } catch {
      throw new SyncV2CommandNotCreatedError(operationId);
    }
    let authority: LiveAuthority;
    try {
      authority = this.#liveAuthority();
    } catch {
      throw new SyncV2CommandNotCreatedError(operationId);
    }
    let operation: V2PersistedOperation;
    try {
      operation = await this.#operationStore.create(this.#savedServerId, operationId, command);
    } catch {
      try {
        const committed = await this.#operationStore.get(this.#savedServerId, operationId);
        if (committed === null) throw new SyncV2CommandNotCreatedError(operationId);
      } catch (cause: unknown) {
        if (cause instanceof SyncV2CommandNotCreatedError) throw cause;
      }
      throw new SyncV2CommandDurableUnsettledError(operationId);
    }
    const pending = commandPending(this.#commands, operationId, operation.commandKind);
    try {
      await this.#dispatchRecoverable(operation, authority);
    } catch {
      this.#commands.delete(operationId);
      pending.reject(new SyncV2CommandDurableUnsettledError(operationId));
    }
    return await pending.promise;
  }

  #connect(): void {
    if (this.#stopped) return;
    this.#phase = "waitingOpen";
    this.#setState("initializing", null);
    let socket: V2SocketLike;
    try {
      socket = this.#transportLease.openSync();
    } catch {
      this.#phase = "offline";
      this.#setState("error", { code: "transport", detail: "socket_open_failed" });
      this.#scheduleReconnect();
      return;
    }
    this.#socket = socket;
    socket.addEventListener("open", () => {
      if (this.#socket !== socket || this.#stopped) return;
      this.#startHeartbeat(socket);
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
        socket.close(
          cause instanceof V2ProtocolValidationError && cause.message === "Malformed Sync V2 JSON"
            ? 1007
            : 1008,
          "invalid_v2_frame",
        );
        this.#setState("error", { code: "protocol", detail: "invalid_v2_frame" });
        return;
      }
      this.#receive(frame);
    });
    socket.addEventListener("error", () => {
      if (this.#socket !== socket || this.#stopped) return;
      this.#setState("error", { code: "transport", detail: "socket_error" });
      setTimeout(() => {
        if (this.#socket === socket && !this.#stopped) socket.close(1011, "socket_error");
      }, 0);
    });
    socket.addEventListener("close", () => this.#handleClose(socket));
  }

  #handleClose(socket: V2SocketLike): void {
    if (this.#socket !== socket) return;
    this.#snapshotCommit?.abort();
    this.#snapshotCommit = null;
    this.#stopHeartbeat();
    this.#stopInitializationDeadline();
    const epochId = this.#epochId;
    this.#socket = undefined;
    this.#phase = "offline";
    this.#epochId = null;
    this.#watermark = null;
    this.#recoveringOperations.clear();
    this.#rejectEphemeral("Sync V2 connection closed; generation-bound requests are never retried");
    this.#setState("offline", null);
    const abandoned = epochId === null ? Promise.resolve(true) : this.#recoverableAbandon(epochId);
    void abandoned.then(() => {
      this.#scheduleReconnect();
    });
  }

  #scheduleReconnect(): void {
    if (this.#stopped || this.#socket !== undefined || this.#reconnectTimer !== undefined) return;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined;
      this.#connect();
    }, this.#reconnectDelayMs);
  }

  #beginEpoch(): void {
    this.#phase = "initializing";
    this.#epochId = null;
    this.#watermark = null;
    this.#armInitializationDeadline("snapshot_timeout");
    try {
      this.#send({ type: "open", version: 2, intent: this.#intent });
    } catch {
      this.#stopInitializationDeadline();
      this.#setState("error", { code: "transport", detail: "open_send_failed" });
      this.#socket?.close(1011, "open_send_failed");
      return;
    }
  }

  #startHeartbeat(socket: V2SocketLike): void {
    this.#stopHeartbeat();
    this.#heartbeatTimer = setInterval(() => {
      if (this.#socket !== socket || this.#stopped) return;
      if (this.#pendingHeartbeatNonce !== null) return;
      const nonce = this.#requestId();
      try {
        this.#send({ type: "ping", nonce });
        this.#pendingHeartbeatNonce = nonce;
        this.#heartbeatDeadlineTimer = setTimeout(() => {
          if (this.#socket !== socket || this.#pendingHeartbeatNonce !== nonce) return;
          this.#setState("error", { code: "transport", detail: "heartbeat_timeout" });
          socket.close(1011, "heartbeat_timeout");
        }, this.#heartbeatTimeoutMs);
      } catch {
        socket.close(1011, "heartbeat_send_failed");
      }
    }, this.#heartbeatIntervalMs);
  }

  #stopHeartbeat(): void {
    if (this.#heartbeatTimer !== undefined) clearInterval(this.#heartbeatTimer);
    this.#heartbeatTimer = undefined;
    if (this.#heartbeatDeadlineTimer !== undefined) clearTimeout(this.#heartbeatDeadlineTimer);
    this.#heartbeatDeadlineTimer = undefined;
    this.#pendingHeartbeatNonce = null;
  }

  #armInitializationDeadline(detail: string): void {
    this.#stopInitializationDeadline();
    const socket = this.#socket;
    this.#initializationDeadlineTimer = setTimeout(() => {
      if (socket === undefined || this.#socket !== socket || this.#phase === "live") return;
      this.#setState("error", { code: "transport", detail });
      socket.close(1011, detail);
    }, this.#initializationTimeoutMs);
  }

  #stopInitializationDeadline(): void {
    if (this.#initializationDeadlineTimer !== undefined)
      clearTimeout(this.#initializationDeadlineTimer);
    this.#initializationDeadlineTimer = undefined;
  }

  #receive(frame: V2ServerFrame): void {
    if (frame.type === "pong") {
      if (frame.nonce !== this.#pendingHeartbeatNonce)
        return this.#protocolFailure("unexpected_pong");
      if (this.#heartbeatDeadlineTimer !== undefined) clearTimeout(this.#heartbeatDeadlineTimer);
      this.#heartbeatDeadlineTimer = undefined;
      this.#pendingHeartbeatNonce = null;
      return;
    }
    if (frame.type === "snapshot") return this.#receiveSnapshot(frame);
    if (frame.type === "change") return this.#receiveChange(frame);
    if (frame.type === "live") return this.#receiveLive(frame);
    if (frame.type === "reinitialize") {
      this.#commandChain = this.#commandChain
        .then(() => this.#receiveReinitialize(frame))
        .catch(() => this.#protocolFailure("command_lifecycle_failed"));
      return;
    }
    if (frame.type === "threadWatched") {
      const pending = this.#threadWatches.get(frame.requestId);
      const requestedThreadId = this.#threadWatchTargets.get(frame.requestId);
      if (pending === undefined) return;
      if (requestedThreadId === undefined)
        return this.#protocolFailure("missing_thread_watch_target");
      if (frame.epochId !== this.#epochId) return this.#protocolFailure("foreign_thread_watch");
      void this.#applyChain
        .then(async () => {
          if (this.#threadWatches.get(frame.requestId) !== pending) return;
          const active = await this.#projectionStore.active(this.#savedServerId);
          if (this.#threadWatches.get(frame.requestId) !== pending) return;
          if (active?.currentThread?.thread.id !== requestedThreadId) {
            this.#deleteThreadWatch(frame.requestId);
            pending.reject(new Error("Sync V2 thread watch did not publish its requested thread"));
            this.#protocolFailure("thread_watch_projection_mismatch");
            return;
          }
          this.#deleteThreadWatch(frame.requestId);
          pending.resolve();
        })
        .catch((cause: unknown) => {
          if (this.#threadWatches.get(frame.requestId) !== pending) return;
          this.#deleteThreadWatch(frame.requestId);
          pending.reject(cause instanceof Error ? cause : new Error("Projection apply failed"));
          this.#projectionFailure(frame.epochId);
        });
      return;
    }
    if (frame.type === "threadWatchFailed") {
      const pending = this.#threadWatches.get(frame.requestId);
      if (pending === undefined) return;
      this.#deleteThreadWatch(frame.requestId);
      pending.reject(new SyncV2RequestError(frame.error));
      return;
    }
    if (frame.type === "queryCompleted" || frame.type === "queryFailed") {
      this.#clearRequestTimer(frame.requestId);
      return settleRequest(this.#queries, frame);
    }
    if (frame.type.startsWith("command")) {
      this.#commandChain = this.#commandChain
        .then(() => this.#settleCommand(frame as CommandFrame))
        .catch(() => this.#protocolFailure("command_lifecycle_failed"));
    }
  }

  #receiveSnapshot(frame: Extract<V2ServerFrame, { type: "snapshot" }>): void {
    if (this.#phase !== "initializing") return this.#protocolFailure("snapshot_out_of_phase");
    const intendedThreadId = this.#intent.currentThread?.threadId ?? null;
    const snapshotThreadId = frame.currentThread?.thread.id ?? null;
    if (snapshotThreadId !== intendedThreadId)
      return this.#protocolFailure("snapshot_thread_mismatch");
    if (
      !validTail(
        frame.watermark,
        frame.includedTail.map(({ watermark }) => watermark),
      )
    )
      return this.#protocolFailure("invalid_snapshot_tail");
    const controller = new AbortController();
    this.#snapshotCommit = controller;
    this.#phase = "awaitingCommit";
    this.#armInitializationDeadline("snapshot_commit_timeout");
    this.#epochId = frame.epochId;
    this.#watermark = frame.watermark;
    this.#applyChain = this.#applyChain
      .then(async () => {
        const committed = await this.#projectionStore.commitSnapshot(
          this.#savedServerId,
          frame,
          controller.signal,
        );
        if (
          committed === null ||
          controller.signal.aborted ||
          this.#epochId !== frame.epochId ||
          this.#phase !== "awaitingCommit"
        )
          return;
        this.#send({
          type: "snapshotCommitted",
          epochId: frame.epochId,
          revision: frame.revision,
          watermark: frame.watermark,
        });
        this.#phase = "draining";
        this.#snapshotCommit = null;
        this.#armInitializationDeadline("live_timeout");
      })
      .catch(() => {
        if (!controller.signal.aborted) this.#projectionFailure(frame.epochId);
      });
  }

  #receiveChange(frame: Extract<V2ServerFrame, { type: "change" }>): void {
    if (this.#phase !== "draining" && this.#phase !== "live")
      return this.#protocolFailure("change_out_of_phase");
    if (
      frame.epochId !== this.#epochId ||
      this.#watermark === null ||
      compareU64(frame.watermark, this.#watermark) <= 0
    )
      return this.#protocolFailure("invalid_change_watermark");
    this.#watermark = frame.watermark;
    this.#applyChain = this.#applyChain
      .then(async () => {
        await this.#projectionStore.applyChange(
          this.#savedServerId,
          frame.epochId,
          frame.watermark,
          frame.change,
        );
        this.#publishChange(frame.change);
      })
      .catch(() => this.#projectionFailure(frame.epochId));
  }

  #receiveLive(frame: Extract<V2ServerFrame, { type: "live" }>): void {
    if (
      this.#phase !== "draining" ||
      frame.epochId !== this.#epochId ||
      frame.watermark !== this.#watermark
    )
      return this.#protocolFailure("invalid_live_boundary");
    this.#applyChain = this.#applyChain
      .then(async () => {
        if (this.#epochId !== frame.epochId) return;
        await this.#commandChain;
        if (this.#epochId !== frame.epochId) return;
        this.#phase = "live";
        this.#stopInitializationDeadline();
        this.#setState("live", null);
        this.#recoverDurableCommands();
      })
      .catch(() => this.#projectionFailure(frame.epochId));
  }

  #receiveReinitialize(frame: Extract<V2ServerFrame, { type: "reinitialize" }>): void {
    const preSnapshot = this.#phase === "initializing" && this.#epochId === null;
    if (!preSnapshot && frame.epochId !== this.#epochId)
      return this.#protocolFailure("foreign_reinitialize");
    if (!["initializing", "awaitingCommit", "draining", "live"].includes(this.#phase))
      return this.#protocolFailure("reinitialize_out_of_phase");
    this.#snapshotCommit?.abort();
    this.#snapshotCommit = null;
    const abandoned = this.#epochId ?? frame.epochId;
    this.#phase = "waitingOpen";
    this.#epochId = null;
    this.#watermark = null;
    this.#recoveringOperations.clear();
    this.#rejectEphemeral(
      "Sync V2 epoch reinitialized; generation-bound requests are never retried",
    );
    this.#setState("reinitializing", { code: "reinitialize", detail: frame.reason });
    void this.#recoverableAbandon(abandoned).then((succeeded) => {
      if (succeeded && this.#phase === "waitingOpen" && this.#socket !== undefined)
        this.#beginEpoch();
      else if (!succeeded && this.#phase === "waitingOpen")
        this.#socket?.close(1011, "durable_abandon_failed");
    });
  }

  #recoverableAbandon(epochId: string): Promise<boolean> {
    const attempt = this.#applyChain.then(() =>
      this.#projectionStore.abandonEpoch(this.#savedServerId, epochId),
    );
    const recovered = attempt.then(
      () => true,
      () => {
        this.#setState("error", { code: "projection", detail: "durable_abandon_failed" });
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
        await this.#operationStore.transition(this.#savedServerId, frame.operationId, ["sent"], {
          state: "accepted",
          acceptedAt: frame.acceptedAt,
        });
      } else if (operation.state !== "accepted") {
        return this.#protocolFailure("command_acceptance_out_of_phase");
      }
      return;
    }
    const preAdmissionTerminal =
      frame.type === "commandRejected" || frame.type === "commandExpired";
    const expected = preAdmissionTerminal ? (["sent"] as const) : (["accepted"] as const);
    if (!expected.includes(operation.state as never))
      return this.#protocolFailure("command_terminal_out_of_phase");
    if (frame.type === "commandCompleted" && frame.result.kind !== operation.commandKind)
      return this.#protocolFailure("command_result_kind_mismatch");
    const state = commandTerminalState(frame);
    await this.#operationStore.transition(this.#savedServerId, frame.operationId, expected, {
      state,
    });
    this.#resolveTerminal(frame);
  }

  #recoverDurableCommands(): void {
    let authority: LiveAuthority;
    try {
      authority = this.#liveAuthority();
    } catch {
      return;
    }
    void this.#operationStore
      .recoverable(this.#savedServerId)
      .then((operations) => {
        for (const operation of operations) {
          if (!this.#sameAuthority(authority)) return;
          if (this.#recoveringOperations.has(operation.operationId)) continue;
          void this.#dispatchRecoverable(operation, authority).catch(() => {
            this.#settleDurableUnsettled(operation.operationId);
          });
        }
      })
      .catch(() => {
        this.#setState("error", { code: "operation", detail: "durable_recovery_failed" });
      });
  }

  async #dispatchRecoverable(
    initial: V2PersistedOperation,
    authority: LiveAuthority,
  ): Promise<void> {
    if (!this.#sameAuthority(authority)) return;
    if (this.#recoveringOperations.has(initial.operationId)) return;
    this.#recoveringOperations.add(initial.operationId);
    let operation = initial;
    try {
      if (operation.state === "created") {
        operation = await this.#operationStore.transition(
          this.#savedServerId,
          operation.operationId,
          ["created"],
          { state: "sent" },
        );
      }
      if (!this.#sameAuthority(authority)) return;
      if (operation.state === "accepted") {
        await this.#recoverAccepted(operation, authority);
        return;
      }
      if (operation.state !== "sent" || operation.command === null) {
        throw new Error("Sync V2 durable operation cannot be dispatched");
      }
      if (!this.#sameAuthority(authority)) return;
      try {
        this.#sendCommand(operation.operationId, operation.command);
      } catch {
        if (this.#sameAuthority(authority))
          authority.socket.close(1011, "durable_command_send_failed");
      }
    } finally {
      this.#recoveringOperations.delete(operation.operationId);
    }
  }

  async #recoverAccepted(operation: V2PersistedOperation, authority: LiveAuthority): Promise<void> {
    if (!this.#sameAuthority(authority)) return;
    const requestId = this.#requestId();
    const pending = pendingPromise(this.#queries, requestId, "operation.get");
    this.#armRequestTimeout(this.#queries, requestId, "query_timeout");
    try {
      this.#send({
        type: "query",
        requestId,
        query: { kind: "operation.get", operationId: operation.operationId },
      });
      const result = await pending;
      if (!this.#sameAuthority(authority) || result.kind !== "operation.get") return;
      this.#operationReceiptFailures.delete(operation.operationId);
      const receipt = result.receipt;
      if (receipt.state === "admitted") {
        setTimeout(() => this.#recoverDurableCommands(), this.#reconnectDelayMs);
        return;
      }
      if (receipt.state === "expired") {
        await this.#operationStore.transition(
          this.#savedServerId,
          operation.operationId,
          ["accepted"],
          { state: "expired" },
        );
        this.#resolveTerminal({
          type: "commandExpired",
          requestId,
          operationId: operation.operationId,
          error: {
            code: "operationExpired",
            recovery: "userAction",
            message: "Operation receipt expired",
          },
        });
        return;
      }
      const frame: V2CommandTerminalFrame =
        receipt.state === "completed"
          ? { type: "commandCompleted", operationId: operation.operationId, result: receipt.result }
          : receipt.state === "failed"
            ? { type: "commandFailed", operationId: operation.operationId, error: receipt.error }
            : {
                type: "commandIndeterminate",
                operationId: operation.operationId,
                error: receipt.error,
              };
      await this.#settleCommand(frame);
    } catch (cause) {
      this.#deletePending(this.#queries, requestId);
      if (!this.#sameAuthority(authority)) return;
      if (isRetryableOperationReceiptFailure(cause)) {
        const failures = (this.#operationReceiptFailures.get(operation.operationId) ?? 0) + 1;
        this.#operationReceiptFailures.set(operation.operationId, failures);
        if (failures >= MAX_OPERATION_RECEIPT_RECOVERY_FAILURES) {
          await this.#markAcceptedDurableUnsettled(operation.operationId);
          return;
        }
        const retryDelayMs = Math.min(
          this.#reconnectDelayMs * 2 ** (failures - 1),
          MAX_OPERATION_RECEIPT_RETRY_DELAY_MS,
        );
        setTimeout(() => this.#recoverDurableCommands(), retryDelayMs);
        return;
      }
      await this.#markAcceptedDurableUnsettled(operation.operationId);
    }
  }

  #sendCommand(operationId: string, command: V2Command): void {
    this.#send({ type: "command", requestId: this.#requestId(), operationId, command });
  }

  #requireLive(): void {
    if (this.#connectionState !== "live" || this.#phase !== "live" || this.#socket === undefined)
      throw new Error("Sync V2 connection is not live");
  }

  #liveAuthority(): LiveAuthority {
    this.#requireLive();
    if (this.#socket === undefined || this.#epochId === null) {
      throw new Error("Sync V2 live authority is unavailable");
    }
    return { socket: this.#socket, epochId: this.#epochId };
  }

  #sameAuthority(authority: LiveAuthority): boolean {
    return (
      this.#connectionState === "live" &&
      this.#phase === "live" &&
      this.#socket === authority.socket &&
      this.#epochId === authority.epochId
    );
  }

  #send(frame: V2ClientFrame): void {
    if (this.#socket === undefined) throw new Error("Sync V2 socket is unavailable");
    this.#socket.send(JSON.stringify(validateV2ClientFrame(frame)));
  }

  #protocolFailure(detail: string): void {
    this.#setState("error", { code: "protocol", detail });
    this.#socket?.close(1008, detail);
  }

  #projectionFailure(epochId: string): void {
    if (this.#epochId !== epochId) return;
    this.#setState("error", { code: "projection", detail: "atomic_projection_failed" });
    this.#socket?.close(1011, "atomic_projection_failed");
  }

  #rejectEphemeral(message: string): void {
    const error = new Error(message);
    for (const pending of [...this.#queries.values(), ...this.#threadWatches.values()])
      pending.reject(error);
    this.#queries.clear();
    this.#threadWatches.clear();
    this.#threadWatchTargets.clear();
    for (const timer of this.#requestTimers.values()) clearTimeout(timer);
    this.#requestTimers.clear();
  }

  #armRequestTimeout<T>(
    map: Map<string, Pending<T>>,
    requestId: string,
    detail: string,
    onTimeout?: () => void,
  ): void {
    const timer = setTimeout(() => {
      this.#requestTimers.delete(requestId);
      const pending = map.get(requestId);
      if (pending === undefined) return;
      map.delete(requestId);
      onTimeout?.();
      pending.reject(new Error(`Sync V2 request timed out: ${pending.kind}`));
      this.#setState("error", { code: "transport", detail });
      if (this.#socket === undefined) this.reconnect();
      else this.#socket.close(1011, detail);
    }, this.#requestTimeoutMs);
    this.#requestTimers.set(requestId, timer);
  }

  #deletePending<T>(map: Map<string, Pending<T>>, requestId: string): void {
    map.delete(requestId);
    this.#clearRequestTimer(requestId);
  }

  #deleteThreadWatch(requestId: string): void {
    this.#threadWatches.delete(requestId);
    this.#threadWatchTargets.delete(requestId);
    this.#clearRequestTimer(requestId);
  }

  #clearRequestTimer(requestId: string): void {
    const timer = this.#requestTimers.get(requestId);
    if (timer !== undefined) clearTimeout(timer);
    this.#requestTimers.delete(requestId);
  }

  #rejectDurableCommands(): void {
    for (const [operationId, pending] of this.#commands) {
      pending.reject(new SyncV2CommandDurableUnsettledError(operationId));
    }
    this.#commands.clear();
  }

  #settleDurableUnsettled(operationId: string): void {
    const pending = this.#commands.get(operationId);
    if (pending === undefined) return;
    this.#commands.delete(operationId);
    pending.reject(new SyncV2CommandDurableUnsettledError(operationId));
  }

  async #markAcceptedDurableUnsettled(operationId: string): Promise<void> {
    this.#operationReceiptFailures.delete(operationId);
    await this.#operationStore.transition(this.#savedServerId, operationId, ["accepted"], {
      state: "indeterminate",
    });
    this.#settleDurableUnsettled(operationId);
  }

  #resolveTerminal(frame: V2CommandTerminalFrame): void {
    this.#recoveringOperations.delete(frame.operationId);
    this.#operationReceiptFailures.delete(frame.operationId);
    const pending = this.#commands.get(frame.operationId);
    if (pending === undefined) return;
    this.#commands.delete(frame.operationId);
    pending.resolve(frame);
  }

  #setState(state: SyncV2ConnectionState, diagnostic: SyncV2SafeDiagnostic | null): void {
    this.#connectionState = state;
    this.#diagnostic = diagnostic;
    try {
      this.#onState(state, diagnostic);
    } catch {
      // An application observer cannot interrupt protocol transitions or fail-closed cleanup.
    }
    this.#publish();
  }

  #observeStores(): void {
    if (this.#storeUnsubscribes.length !== 0) return;
    const publish = () => this.#publish();
    this.#storeUnsubscribes = [
      this.#projectionStore.subscribe(this.#savedServerId, publish),
      this.#operationStore.subscribe(this.#savedServerId, publish),
    ];
  }

  #publish(): void {
    this.#publicationVersion += 1;
    for (const observer of this.#observers) {
      try {
        observer();
      } catch {
        // Observer failures are isolated from protocol and durable state changes.
      }
    }
  }

  #publishChange(change: V2ProjectionChange): void {
    for (const listener of this.#changeObservers) {
      try {
        listener(change);
      } catch {
        // Semantic invalidation observers cannot interrupt the projection owner.
      }
    }
  }
}

function positiveDuration(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isFinite(value) || value <= 0 ? fallback : value;
}
