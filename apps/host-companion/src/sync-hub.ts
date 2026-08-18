import { randomUUID } from "node:crypto";

import { WebSocket } from "ws";

import { isExposedRpcMethod } from "./rpc-policy.js";
import { ReplayJournal, type ReplayEntry } from "./replay-journal.js";
import { HostQueueStore } from "./host-queue.js";
import { hasScope, requiredScopeForRpc, type AuthorizationContext } from "./capabilities.js";
import type { LocalRpcHandler } from "./dictation.js";
import { BoundedOutboundQueue } from "./outbound-queue.js";
import { compactInlineImagesInNotification } from "./inline-image-projection.js";
import type { ContentProjector } from "./content-projection.js";
import { attachThreadPatch } from "./thread-patch.js";

type RpcObject = Record<string, unknown>;

type SyncClientMessage =
  | { type: "hello"; protocolVersion: 1; cursor: number | null }
  | { type: "rpc"; request: RpcObject }
  | { type: "serverResponse"; response: RpcObject }
  | { type: "snapshotApplied"; cursor: number }
  | { type: "ack"; cursor: number }
  | { type: "ping"; nonce?: string };

type ClientState = {
  id: string;
  socket: WebSocket;
  helloReceived: boolean;
  readyForEvents: boolean;
  lastAck: number;
  authorization: AuthorizationContext;
  preparingRpcs: number;
  outbound: BoundedOutboundQueue;
};

type PrepareRpcParams = (method: string, params: RpcObject) => Promise<RpcObject>;
type ObserveAppServerPayload = (method: string, payload: unknown, requestParams?: RpcObject) => void;

type PendingRequest =
  | { kind: "client"; clientId: string; originalId: unknown; method: string; params: RpcObject }
  | { kind: "queueRead"; commandId: string }
  | { kind: "queueStart"; commandId: string };

const INITIALIZE_ID = "codewide-hub-initialize";
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
const MAX_OUTBOUND_FRAME_BYTES = 64 * 1024 * 1024;
const MAX_OUTBOUND_QUEUE_BYTES = 64 * 1024 * 1024;
// A large reconnect replay is slower and less reliable than the protocol's
// summary snapshot. Keep the burst below both the host WebSocket buffer and
// the Android native durable-frame journal, then replay only the small tail
// that arrived while the snapshot was being applied.
const MAX_INCREMENTAL_REPLAY_ENTRIES = 512;
const MAX_INCREMENTAL_REPLAY_BYTES = 1024 * 1024;
const MAX_PENDING_RPCS_PER_CLIENT = 128;
const MAX_PENDING_RPCS_GLOBAL = 1_024;
const MAX_PENDING_SERVER_REQUESTS = 1_024;
const MAX_PENDING_SERVER_REQUEST_BYTES = 4 * 1024 * 1024;
const MAX_SINGLE_SERVER_REQUEST_BYTES = 1024 * 1024;
const LIVE_EVENT_BATCH_MS = 32;
const LIVE_TEXT_EVENT_BATCH_MS = 16;
const MAX_LIVE_EVENT_BATCH_ENTRIES = 256;
const USER_SERVER_REQUEST_METHODS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/tool/requestUserInput",
  "item/permissions/requestApproval",
  "mcpServer/elicitation/request",
]);
const IMMEDIATE_LIVE_EVENT_METHODS = new Set([
  ...USER_SERVER_REQUEST_METHODS,
  "turn/started",
  "turn/completed",
  "companion/queue/changed",
  "item/started",
  "item/completed",
  "thread/status/changed",
  "serverRequest/resolved",
  "thread/realtime/error",
  "thread/realtime/closed",
  "error",
]);
const LOW_LATENCY_LIVE_EVENT_METHODS = new Set([
  "item/agentMessage/delta",
]);
export const THREAD_READ_MODEL_VERSION = 1;

export function shouldFlushLiveEventBatch(method: string | null): boolean {
  return method !== null && IMMEDIATE_LIVE_EVENT_METHODS.has(method);
}

export function liveEventBatchDelayMs(method: string | null): number {
  return method !== null && LOW_LATENCY_LIVE_EVENT_METHODS.has(method)
    ? LIVE_TEXT_EVENT_BATCH_MS
    : LIVE_EVENT_BATCH_MS;
}

export class AppServerSyncHub {
  readonly #connectUpstream: () => WebSocket;
  readonly #journal: ReplayJournal;
  readonly #queue: HostQueueStore;
  readonly #prepareRpcParams: PrepareRpcParams;
  readonly #observeAppServerPayload: ObserveAppServerPayload;
  readonly #localRpcHandler: LocalRpcHandler | undefined;
  readonly #contentProjector: ContentProjector | undefined;
  readonly #clients = new Map<string, ClientState>();
  readonly #pending = new Map<string, PendingRequest>();
  readonly #serverRequests = new Map<string, { message: RpcObject; bytes: number }>();
  readonly #resolvingServerRequests = new Set<string>();
  #serverRequestBytes = 0;
  #upstream: WebSocket | undefined;
  #upstreamReady = false;
  #upstreamCounter = 0;
  #closed = false;
  #journalFailed = false;
  #eventChain = Promise.resolve();
  #pendingEvents: RpcObject[] = [];
  #eventFlushTimer: NodeJS.Timeout | undefined;
  #eventFlushAt: number | undefined;
  #reconnectTimer: NodeJS.Timeout | undefined;
  #reconnectAttempt = 0;
  #queueTimer: NodeJS.Timeout | undefined;
  readonly #queueChecking = new Set<string>();

  constructor(
    connectUpstream: () => WebSocket,
    journal: ReplayJournal,
    queue: HostQueueStore,
    prepareRpcParams: PrepareRpcParams = async (_method, params) => params,
    observeAppServerPayload: ObserveAppServerPayload = () => undefined,
    localRpcHandler?: LocalRpcHandler,
    contentProjector?: ContentProjector,
  ) {
    this.#connectUpstream = connectUpstream;
    this.#journal = journal;
    this.#queue = queue;
    this.#prepareRpcParams = prepareRpcParams;
    this.#observeAppServerPayload = observeAppServerPayload;
    this.#localRpcHandler = localRpcHandler;
    this.#contentProjector = contentProjector;
  }

  attach(socket: WebSocket, authorization: AuthorizationContext): void {
    let client: ClientState;
    const outbound = new BoundedOutboundQueue({
      socket,
      openReadyState: WebSocket.OPEN,
      maxFrameBytes: MAX_OUTBOUND_FRAME_BYTES,
      maxQueuedBytes: MAX_OUTBOUND_QUEUE_BYTES,
      close: (code, reason) => this.#closeClient(client, code, reason),
      onLimit: ({ reason, frameBytes, queuedBytes }) => console.warn(JSON.stringify({
        status: "sync-client-outbound-limit",
        reason,
        frameBytes,
        queuedBytes,
      })),
    });
    client = {
      id: randomUUID(),
      socket,
      helloReceived: false,
      readyForEvents: false,
      lastAck: 0,
      authorization,
      preparingRpcs: 0,
      outbound,
    };
    this.#clients.set(client.id, client);
    if (this.#journalFailed) {
      queueMicrotask(() => this.#closeClient(client, 1011, "replay_journal_failed"));
      return;
    }
    const helloTimer = setTimeout(() => this.#closeClient(client, 1008, "hello_required"), 10_000);
    helloTimer.unref();
    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        this.#closeClient(client, 1003, "text_frames_only");
        return;
      }
      const awaitingHello = !client.helloReceived;
      this.#handleClientMessage(client, data.toString("utf8"));
      if (awaitingHello && client.helloReceived) clearTimeout(helloTimer);
    });
    socket.once("close", (code, rawReason) => {
      clearTimeout(helloTimer);
      client.outbound.dispose();
      this.#clients.delete(client.id);
      this.#localRpcHandler?.releaseClient(localRpcOwnerId(client));
      for (const [id, pending] of this.#pending) {
        if (pending.kind === "client" && pending.clientId === client.id) this.#pending.delete(id);
      }
      if (code >= 1002) {
        const reason = rawReason.toString("utf8").replace(/[^A-Za-z0-9_ .:-]/g, "?").slice(0, 120);
        console.warn(JSON.stringify({ status: "sync-client-closed", code, reason }));
      }
    });
    socket.once("error", () => this.#clients.delete(client.id));
    this.#ensureUpstream();
  }

  async close(): Promise<void> {
    this.#closed = true;
    if (this.#reconnectTimer !== undefined) clearTimeout(this.#reconnectTimer);
    if (this.#queueTimer !== undefined) clearTimeout(this.#queueTimer);
    if (this.#eventFlushTimer !== undefined) clearTimeout(this.#eventFlushTimer);
    this.#eventFlushTimer = undefined;
    this.#eventFlushAt = undefined;
    this.#flushPendingEvents();
    for (const client of this.#clients.values()) client.socket.close(1001, "server_shutdown");
    this.#clients.clear();
    this.#localRpcHandler?.close();
    if (this.#upstream?.readyState === WebSocket.OPEN || this.#upstream?.readyState === WebSocket.CONNECTING) {
      this.#upstream.close(1001, "server_shutdown");
    }
    await this.#eventChain;
    await this.#journal.close();
    await this.#queue.close();
  }

  #handleClientMessage(client: ClientState, raw: string): void {
    let message: SyncClientMessage;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not_object");
      message = parsed as SyncClientMessage;
    } catch {
      this.#closeClient(client, 1007, "invalid_json_object");
      return;
    }
    if (!client.helloReceived) {
      if (message.type !== "hello" || message.protocolVersion !== 1) {
        this.#closeClient(client, 1008, "hello_required");
        return;
      }
      client.helloReceived = true;
      this.#resume(client, message.cursor);
      return;
    }
    switch (message.type) {
      case "hello":
        this.#closeClient(client, 1008, "duplicate_hello");
        break;
      case "rpc":
        void this.#forwardRpc(client, message.request);
        break;
      case "serverResponse":
        this.#forwardServerResponse(client, message.response);
        break;
      case "snapshotApplied":
        console.info(JSON.stringify({ status: "sync-snapshot-applied", cursor: message.cursor }));
        this.#resume(client, message.cursor);
        break;
      case "ack":
        if (!Number.isSafeInteger(message.cursor) || message.cursor > this.#journal.headCursor) {
          this.#closeClient(client, 1008, "invalid_ack_cursor");
          return;
        }
        // WebSocket preserves wire order, but a durable native client may replay
        // an older already-applied frame after its runtime reattaches. A stale
        // acknowledgement carries no new information and is safely idempotent.
        if (message.cursor < client.lastAck) return;
        client.lastAck = message.cursor;
        break;
      case "ping":
        this.#send(client, { type: "pong", ...(message.nonce === undefined ? {} : { nonce: message.nonce }) });
        break;
      default:
        this.#closeClient(client, 1008, "unknown_sync_message");
    }
  }

  #resume(client: ClientState, cursor: number | null): void {
    const replay = this.#journal.replay(cursor);
    const incrementalEntries = replay.snapshotRequired ? [] : replay.entries;
    let snapshotRequired = replay.snapshotRequired || incrementalEntries.length > MAX_INCREMENTAL_REPLAY_ENTRIES;
    let incrementalBytes = 0;
    // Once the entry cap already mandates a snapshot, serializing tens of
    // megabytes merely to calculate an unused replay size delays the hello.
    if (!snapshotRequired) {
      for (const entry of incrementalEntries) {
        incrementalBytes += Buffer.byteLength(JSON.stringify(entry));
        if (incrementalBytes > MAX_INCREMENTAL_REPLAY_BYTES) {
          snapshotRequired = true;
          break;
        }
      }
    }
    const replayEntries = snapshotRequired ? 0 : incrementalEntries.length;
    const replayBytes = snapshotRequired ? 0 : incrementalBytes;
    console.info(JSON.stringify({
      status: "sync-resume",
      cursor,
      headCursor: replay.headCursor,
      snapshotRequired,
      replayEntries,
      replayBytes,
    }));
    client.readyForEvents = false;
    this.#send(client, {
      type: "hello",
      protocolVersion: 1,
      headCursor: replay.headCursor,
      snapshotRequired,
      pendingRequests: hasScope(client.authorization, "approvals.respond")
        ? [...this.#serverRequests.values()]
            .map(({ message }) => message)
            .filter((message) => typeof message.method === "string" && USER_SERVER_REQUEST_METHODS.has(message.method) && asObject(message.params) !== null)
            .map((request) => structuredClone(request))
        : [],
    });
    this.#send(client, { type: "status", status: this.#upstreamReady ? "live" : "reconnecting" });
    if (snapshotRequired) return;
    this.#sendEntries(client, incrementalEntries);
    client.readyForEvents = true;
    client.lastAck = Math.min(cursor ?? 0, replay.headCursor);
    this.#send(client, { type: "caughtUp", cursor: replay.headCursor });
  }

  async #forwardRpc(client: ClientState, request: RpcObject): Promise<void> {
    const method = request.method;
    const requiredScope = typeof method === "string" ? requiredScopeForRpc(method) : null;
    if (typeof method === "string" && (requiredScope === null || !hasScope(client.authorization, requiredScope))) {
      this.#sendRpcError(client, request.id, -32001, `Capability does not allow RPC method: ${method}`);
      return;
    }
    if (typeof method === "string" && this.#localRpcHandler?.handles(method) === true) {
      if (!("id" in request)) {
        this.#sendRpcError(client, null, -32600, "Companion RPC requests require an id");
        return;
      }
      const preparingGlobally = [...this.#clients.values()].reduce((total, candidate) => total + candidate.preparingRpcs, 0);
      if (client.preparingRpcs >= MAX_PENDING_RPCS_PER_CLIENT || preparingGlobally >= MAX_PENDING_RPCS_GLOBAL) {
        this.#sendRpcError(client, request.id, -32004, "Host RPC backpressure limit reached");
        return;
      }
      client.preparingRpcs += 1;
      void this.#localRpcHandler.handle(localRpcOwnerId(client), method, asObject(request.params) ?? {})
        .then((result) => {
          if (this.#clients.has(client.id)) {
            const projected = this.#contentProjector?.projectRpcResult(method, result) ?? result;
            this.#observeAppServerPayload(method, projected, asObject(request.params) ?? {});
            this.#send(client, { type: "rpc", response: { id: request.id, result: projected } });
          }
        })
        .catch((cause: unknown) => {
          if (this.#clients.has(client.id)) {
            this.#sendRpcError(client, request.id, -32020, cause instanceof Error ? cause.message : "Companion operation failed");
          }
        })
        .finally(() => { client.preparingRpcs -= 1; });
      return;
    }
    if (typeof method === "string" && method.startsWith("companion/queue/")) {
      if (!("id" in request)) {
        this.#sendRpcError(client, null, -32600, "Companion queue requests require an id");
        return;
      }
      const preparingGlobally = [...this.#clients.values()].reduce((total, candidate) => total + candidate.preparingRpcs, 0);
      if (client.preparingRpcs >= MAX_PENDING_RPCS_PER_CLIENT || preparingGlobally >= MAX_PENDING_RPCS_GLOBAL) {
        this.#sendRpcError(client, request.id, -32004, "Host RPC backpressure limit reached");
        return;
      }
      client.preparingRpcs += 1;
      void this.#handleQueueRpc(client, request.id, method, asObject(request.params) ?? {})
        .finally(() => { client.preparingRpcs -= 1; });
      return;
    }
    if (typeof method !== "string" || method === "initialize" || method === "initialized" || !isExposedRpcMethod(method)) {
      this.#sendRpcError(client, request.id, -32601, `Method is not exposed by CodeWide sync: ${String(method)}`);
      return;
    }
    if (!("id" in request)) {
      this.#sendRpcError(client, null, -32600, "Sync RPC requests require an id");
      return;
    }
    if (!this.#upstreamReady || this.#upstream?.readyState !== WebSocket.OPEN) {
      this.#sendRpcError(client, request.id, -32003, "App Server is reconnecting");
      this.#ensureUpstream();
      return;
    }
    const preparingGlobally = [...this.#clients.values()].reduce((total, candidate) => total + candidate.preparingRpcs, 0);
    if (this.#pending.size + preparingGlobally >= MAX_PENDING_RPCS_GLOBAL || this.#upstream.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.#sendRpcError(client, request.id, -32004, "Host RPC backpressure limit reached");
      return;
    }
    let pendingForClient = 0;
    for (const pending of this.#pending.values()) {
      if (pending.kind === "client" && pending.clientId === client.id) pendingForClient += 1;
    }
    if (pendingForClient + client.preparingRpcs >= MAX_PENDING_RPCS_PER_CLIENT) {
      this.#sendRpcError(client, request.id, -32004, "Too many pending RPC requests");
      return;
    }
    client.preparingRpcs += 1;
    let params: RpcObject;
    try {
      params = await this.#prepareRpcParams(method, asObject(request.params) ?? {});
    } catch (cause) {
      this.#sendRpcError(client, request.id, -32602, cause instanceof Error ? cause.message : "Invalid RPC params");
      return;
    } finally {
      client.preparingRpcs -= 1;
    }
    if (!this.#clients.has(client.id) || !this.#upstreamReady || this.#upstream?.readyState !== WebSocket.OPEN) {
      this.#sendRpcError(client, request.id, -32003, "App Server is reconnecting");
      this.#ensureUpstream();
      return;
    }
    if (this.#pending.size >= MAX_PENDING_RPCS_GLOBAL || this.#upstream.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.#sendRpcError(client, request.id, -32004, "Host RPC backpressure limit reached");
      return;
    }
    const upstreamId = `codewide:${client.id}:${++this.#upstreamCounter}`;
    this.#pending.set(upstreamId, { kind: "client", clientId: client.id, originalId: request.id, method, params });
    const upstreamParams = method === "thread/resume" && asObject(params.initialTurnsPage) !== null
      ? Object.fromEntries(Object.entries(params).filter(([key]) => key !== "initialTurnsPage"))
      : params;
    this.#upstream.send(JSON.stringify({ ...request, id: upstreamId, params: upstreamParams }));
  }

  #forwardServerResponse(client: ClientState, response: RpcObject): void {
    if (!hasScope(client.authorization, "approvals.respond")) {
      this.#send(client, { type: "serverResponseRejected", id: response.id, reason: "capability_denied" });
      return;
    }
    if (!("id" in response) || (!("result" in response) && !("error" in response))) {
      this.#closeClient(client, 1008, "invalid_server_response");
      return;
    }
    const key = rpcIdKey(response.id);
    if (!this.#serverRequests.has(key)) {
      this.#send(client, { type: "serverResponseRejected", id: response.id, reason: "already_resolved_or_unknown" });
      return;
    }
    if (this.#resolvingServerRequests.has(key)) {
      this.#send(client, { type: "serverResponseRejected", id: response.id, reason: "already_resolving" });
      return;
    }
    if (!this.#upstreamReady || this.#upstream?.readyState !== WebSocket.OPEN) {
      this.#send(client, { type: "serverResponseRejected", id: response.id, reason: "app_server_reconnecting" });
      return;
    }
    if (this.#upstream.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.#send(client, { type: "serverResponseRejected", id: response.id, reason: "upstream_backpressure" });
      return;
    }
    const upstream = this.#upstream;
    this.#resolvingServerRequests.add(key);
    try {
      upstream.send(JSON.stringify(response), (error) => {
        const stillClaimed = this.#resolvingServerRequests.delete(key);
        if (!stillClaimed || error != null || this.#upstream !== upstream || !this.#upstreamReady) {
          this.#send(client, { type: "serverResponseRejected", id: response.id, reason: "upstream_delivery_failed" });
          return;
        }
        this.#removeServerRequest(key);
        this.#send(client, { type: "serverResponseAccepted", id: response.id });
        this.#appendResolvedEvent(response.id, "responded");
      });
    } catch {
      this.#resolvingServerRequests.delete(key);
      this.#send(client, { type: "serverResponseRejected", id: response.id, reason: "upstream_delivery_failed" });
    }
  }

  #ensureUpstream(): void {
    if (this.#closed || this.#upstream?.readyState === WebSocket.OPEN || this.#upstream?.readyState === WebSocket.CONNECTING) return;
    const upstream = this.#connectUpstream();
    this.#upstream = upstream;
    this.#upstreamReady = false;
    upstream.once("open", () => {
      upstream.send(JSON.stringify({
        id: INITIALIZE_ID,
        method: "initialize",
        params: {
          clientInfo: { name: "codewide_host", title: "CodeWide Host", version: "0.1.0" },
          capabilities: { experimentalApi: true },
        },
      }));
    });
    upstream.on("message", (data, isBinary) => {
      if (isBinary) {
        upstream.close(1003, "text_frames_only");
        return;
      }
      this.#handleUpstreamMessage(data.toString("utf8"));
    });
    upstream.once("close", () => {
      if (this.#upstream === upstream) {
        this.#upstream = undefined;
        this.#upstreamReady = false;
        for (const pending of this.#pending.values()) {
          if (pending.kind !== "client") continue;
          const client = this.#clients.get(pending.clientId);
          if (client !== undefined) this.#sendRpcError(client, pending.originalId, -32003, "App Server disconnected");
        }
        this.#pending.clear();
        this.#queueChecking.clear();
        this.#resolvingServerRequests.clear();
        for (const { message } of this.#serverRequests.values()) this.#appendResolvedEvent(message.id, "upstream_disconnected");
        this.#serverRequests.clear();
        this.#serverRequestBytes = 0;
        for (const client of this.#clients.values()) this.#send(client, { type: "status", status: "reconnecting" });
        this.#scheduleReconnect();
      }
    });
    upstream.once("error", () => {
      for (const client of this.#clients.values()) this.#send(client, { type: "status", status: "degraded" });
    });
  }

  #handleUpstreamMessage(raw: string): void {
    let message: RpcObject;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return;
      message = parsed as RpcObject;
    } catch {
      return;
    }
    if (message.id === INITIALIZE_ID) {
      if ("error" in message) {
        for (const client of this.#clients.values()) this.#send(client, { type: "status", status: "authRequired" });
        this.#upstream?.close(1011, "initialize_failed");
        return;
      }
      this.#upstream?.send(JSON.stringify({ method: "initialized" }));
      this.#upstreamReady = true;
      this.#reconnectAttempt = 0;
      for (const client of this.#clients.values()) this.#send(client, { type: "status", status: "live" });
      this.#scheduleQueuePump(0);
      return;
    }
    if ("id" in message && typeof message.method !== "string") {
      const pending = this.#pending.get(String(message.id));
      if (pending === undefined) return;
      this.#pending.delete(String(message.id));
      if (pending.kind === "client") {
        const projectedResult = this.#contentProjector?.projectRpcResult(pending.method, message.result) ?? message.result;
        if (projectedResult !== message.result) message = { ...message, result: projectedResult };
        this.#observeAppServerPayload(pending.method, projectedResult, pending.params);
        if (pending.method === "thread/list") {
          const result = asObject(message.result);
          console.info(JSON.stringify({
            status: "sync-thread-list",
            count: Array.isArray(result?.data) ? result.data.length : null,
            hasNextCursor: typeof result?.nextCursor === "string",
            failed: "error" in message,
          }));
        }
        const client = this.#clients.get(pending.clientId);
        if (client !== undefined && pending.method === "thread/resume" && asObject(pending.params.initialTurnsPage) !== null && !("error" in message)) {
          void this.#sendResumeWithIndexedPage(client, pending, message);
        } else if (client !== undefined) {
          this.#send(client, { type: "rpc", response: { ...message, id: pending.originalId } });
        }
      } else if (pending.kind === "queueRead") {
        this.#observeAppServerPayload("thread/read", message.result);
        void this.#handleQueueReadResult(pending.commandId, message)
          .finally(() => this.#queueChecking.delete(pending.commandId));
      } else {
        void this.#handleQueueStartResult(pending.commandId, message);
      }
      return;
    }
    if (typeof message.method !== "string") return;
    const notificationMethod = message.method;
    this.#observeAppServerPayload(notificationMethod, message.params);
    const compactedParams = this.#contentProjector?.projectNotification(notificationMethod, message.params)
      ?? compactInlineImagesInNotification(notificationMethod, message.params);
    if (compactedParams !== message.params) {
      message = { ...message, params: compactedParams };
      // The compact projection contains the exact localImage path that the
      // private preview allow-list must observe before a client can request it.
      this.#observeAppServerPayload(notificationMethod, compactedParams);
    }
    message = attachThreadPatch(message);
    if (message.method === "serverRequest/resolved") {
      const params = asObject(message.params);
      if (params !== null && "requestId" in params) this.#removeServerRequest(rpcIdKey(params.requestId));
    } else if ("id" in message) {
      const key = rpcIdKey(message.id);
      const bytes = Buffer.byteLength(raw);
      const existing = this.#serverRequests.get(key);
      const nextBytes = this.#serverRequestBytes - (existing?.bytes ?? 0) + bytes;
      if (
        (existing === undefined && this.#serverRequests.size >= MAX_PENDING_SERVER_REQUESTS) ||
        bytes > MAX_SINGLE_SERVER_REQUEST_BYTES ||
        nextBytes > MAX_PENDING_SERVER_REQUEST_BYTES
      ) {
        this.#upstream?.close(1013, "server_request_backpressure");
        return;
      }
      this.#serverRequests.set(key, { message: structuredClone(message), bytes });
      this.#serverRequestBytes = nextBytes;
    }
    this.#appendEvent(message);
    if (message.method === "turn/completed" || message.method === "thread/status/changed") this.#scheduleQueuePump(0);
  }

  async #sendResumeWithIndexedPage(
    client: ClientState,
    pending: Extract<PendingRequest, { kind: "client" }>,
    message: RpcObject,
  ): Promise<void> {
    const pageParams = asObject(pending.params.initialTurnsPage);
    const threadId = pending.params.threadId;
    if (pageParams === null || typeof threadId !== "string" || this.#localRpcHandler?.handles("thread/turns/list") !== true) {
      this.#sendRpcError(client, pending.originalId, -32020, "Indexed thread history is unavailable");
      return;
    }
    try {
      const result = asObject(message.result);
      const resumedThread = asObject(result?.thread);
      const expectedRecencyAt = typeof resumedThread?.recencyAt === "number" ? resumedThread.recencyAt : undefined;
      const initialTurnsPage = await this.#localRpcHandler.handle(localRpcOwnerId(client), "thread/turns/list", {
        threadId,
        ...pageParams,
        cursor: null,
        ...(expectedRecencyAt === undefined ? {} : { expectedRecencyAt }),
      });
      if (!this.#clients.has(client.id)) return;
      const page = asObject(initialTurnsPage);
      if (result === null || page === null) throw new Error("Indexed thread history returned an invalid response");
      const thread = materializeThreadResumeReadModel(result, page);
      this.#observeAppServerPayload("thread/turns/list", page, { threadId });
      this.#send(client, {
        type: "rpc",
        response: {
          ...message,
          id: pending.originalId,
          result: {
            ...result,
            thread,
            initialTurnsPage: page,
            turnsBackwardsCursor: page.backwardsCursor ?? null,
            codewideReadModelVersion: THREAD_READ_MODEL_VERSION,
          },
        },
      });
    } catch (cause) {
      if (this.#clients.has(client.id)) {
        this.#sendRpcError(client, pending.originalId, -32020, cause instanceof Error ? cause.message : "Indexed thread history failed");
      }
    }
  }

  #appendResolvedEvent(requestId: unknown, reason: string): void {
    this.#appendEvent({ method: "serverRequest/resolved", params: { requestId, reason } });
  }

  #removeServerRequest(key: string): void {
    const removed = this.#serverRequests.get(key);
    if (removed === undefined) return;
    this.#serverRequests.delete(key);
    this.#serverRequestBytes = Math.max(0, this.#serverRequestBytes - removed.bytes);
  }

  #appendEvent(message: RpcObject): void {
    if (this.#journalFailed) return;
    this.#pendingEvents.push(message);
    const method = typeof message.method === "string" ? message.method : null;
    if (this.#pendingEvents.length >= MAX_LIVE_EVENT_BATCH_ENTRIES || shouldFlushLiveEventBatch(method)) {
      if (this.#eventFlushTimer !== undefined) clearTimeout(this.#eventFlushTimer);
      this.#eventFlushTimer = undefined;
      this.#eventFlushAt = undefined;
      this.#flushPendingEvents();
      return;
    }
    const delayMs = liveEventBatchDelayMs(method);
    const flushAt = Date.now() + delayMs;
    if (this.#eventFlushTimer !== undefined && this.#eventFlushAt !== undefined && this.#eventFlushAt <= flushAt) return;
    if (this.#eventFlushTimer !== undefined) clearTimeout(this.#eventFlushTimer);
    this.#eventFlushAt = flushAt;
    this.#eventFlushTimer = setTimeout(() => {
      this.#eventFlushTimer = undefined;
      this.#eventFlushAt = undefined;
      this.#flushPendingEvents();
    }, delayMs);
    this.#eventFlushTimer.unref();
  }

  #flushPendingEvents(): void {
    if (this.#pendingEvents.length === 0 || this.#journalFailed) return;
    const payloads = this.#pendingEvents.splice(0);
    this.#eventChain = this.#eventChain
      .then(async () => {
        const entries = await this.#journal.appendBatch(payloads);
        for (const client of this.#clients.values()) {
          if (client.readyForEvents) this.#sendEntries(client, entries);
        }
      })
      .catch(() => {
        this.#journalFailed = true;
        for (const client of this.#clients.values()) this.#closeClient(client, 1011, "replay_journal_failed");
        if (this.#upstream?.readyState === WebSocket.OPEN || this.#upstream?.readyState === WebSocket.CONNECTING) {
          this.#upstream.close(1011, "replay_journal_failed");
        }
      });
  }

  #sendEntry(client: ClientState, entry: ReplayEntry): void {
    this.#send(client, { type: "event", cursor: entry.cursor, payload: entry.payload });
  }

  #sendEntries(client: ClientState, entries: readonly ReplayEntry[]): void {
    // Preserve the v1 wire contract and Android's native durable-frame
    // journal. The entries are already persisted in one batch above; sending
    // the compatible frames back-to-back lets the existing 50 ms UI buffer
    // reduce and render the whole burst once.
    for (const entry of entries) this.#sendEntry(client, entry);
  }

  #scheduleReconnect(): void {
    if (this.#closed || this.#reconnectTimer !== undefined) return;
    const delay = Math.min(30_000, 250 * 2 ** Math.min(this.#reconnectAttempt, 7));
    this.#reconnectAttempt += 1;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined;
      this.#ensureUpstream();
    }, delay);
    this.#reconnectTimer.unref();
  }

  async #handleQueueRpc(client: ClientState, id: unknown, method: string, params: RpcObject): Promise<void> {
    try {
      let result: unknown;
      if (method === "companion/queue/put") {
        const command = asObject(params.command) ?? params;
        const commandMethod = stringValue(command.method);
        const commandParams = asObject(command.params) ?? {};
        // Fail immediately if an attachment is missing or escapes its root,
        // while keeping root-relative references durable in the queue file.
        await this.#prepareRpcParams(commandMethod, commandParams);
        result = await this.#queue.put({
          commandId: stringValue(command.commandId),
          remoteThreadId: stringValue(command.remoteThreadId),
          method: commandMethod,
          params: commandParams,
          ...(typeof command.createdAt === "number" ? { createdAt: command.createdAt } : {}),
        });
        this.#appendQueueChanged(stringValue(command.remoteThreadId));
        this.#scheduleQueuePump(0);
      } else if (method === "companion/queue/list") {
        const threadId = typeof params.threadId === "string" ? params.threadId : undefined;
        result = { data: this.#queue.list(threadId) };
      } else if (method === "companion/queue/edit") {
        const commandId = stringValue(params.commandId);
        const threadId = this.#queueThreadId(commandId);
        result = await this.#queue.editText(commandId, stringValue(params.text));
        if (threadId !== null) this.#appendQueueChanged(threadId);
      } else if (method === "companion/queue/cancel") {
        const commandId = stringValue(params.commandId);
        const threadId = this.#queueThreadId(commandId);
        result = { cancelled: await this.#queue.cancel(commandId) };
        if (threadId !== null) this.#appendQueueChanged(threadId);
      } else if (method === "companion/queue/move") {
        const commandId = stringValue(params.commandId);
        const threadId = this.#queueThreadId(commandId);
        if (Object.prototype.hasOwnProperty.call(params, "beforeCommandId")) {
          const beforeCommandId = params.beforeCommandId === null ? null : stringValue(params.beforeCommandId);
          result = { moved: await this.#queue.place(commandId, beforeCommandId) };
        } else {
          const direction = params.direction;
          if (direction !== -1 && direction !== 1) throw new Error("Queue direction must be -1 or 1");
          result = { moved: await this.#queue.move(commandId, direction) };
        }
        if (threadId !== null) this.#appendQueueChanged(threadId);
      } else {
        throw new Error("Unknown companion queue method");
      }
      this.#send(client, { type: "rpc", response: { id, result } });
    } catch (cause) {
      this.#sendRpcError(client, id, -32010, cause instanceof Error ? cause.message : "Companion queue operation failed");
    }
  }

  #scheduleQueuePump(delayMs: number): void {
    if (this.#closed || this.#queueTimer !== undefined) return;
    this.#queueTimer = setTimeout(() => {
      this.#queueTimer = undefined;
      this.#pumpQueue();
    }, delayMs);
    this.#queueTimer.unref();
  }

  #pumpQueue(): void {
    if (!this.#upstreamReady || this.#upstream?.readyState !== WebSocket.OPEN) return;
    let pendingHostRequests = [...this.#pending.values()].filter((pending) => pending.kind !== "client").length;
    for (const command of this.#queue.readyHeads()) {
      if (pendingHostRequests >= 64 || this.#pending.size >= MAX_PENDING_RPCS_GLOBAL || this.#upstream.bufferedAmount > MAX_BUFFERED_BYTES) break;
      if (this.#queueChecking.has(command.commandId)) continue;
      this.#queueChecking.add(command.commandId);
      const upstreamId = `codewide:queue-read:${++this.#upstreamCounter}`;
      this.#pending.set(upstreamId, { kind: "queueRead", commandId: command.commandId });
      this.#upstream.send(JSON.stringify({
        id: upstreamId,
        method: "thread/turns/list",
        params: {
          threadId: command.remoteThreadId,
          cursor: null,
          limit: 2,
          sortDirection: "desc",
          itemsView: "summary",
        },
      }));
      pendingHostRequests += 1;
    }
  }

  async #handleQueueReadResult(commandId: string, response: RpcObject): Promise<void> {
    const command = this.#queue.list().find((candidate) => candidate.commandId === commandId);
    if (command === undefined) return;
    if ("error" in response) {
      // An uncertain command may already have reached App Server. A failed
      // reconciliation read is not evidence that it is safe to retry.
      if (command.state === "queued") await this.#queue.markQueued(commandId, rpcErrorMessage(response.error));
      this.#appendQueueChanged(command.remoteThreadId);
      this.#scheduleQueuePump(2_000);
      return;
    }
    const result = asObject(response.result);
    const turns = Array.isArray(result?.data) ? result.data : null;
    if (turns === null) {
      await this.#queue.markFailed(commandId, "thread/turns/list returned no turns page");
      this.#appendQueueChanged(command.remoteThreadId);
      return;
    }
    if (turnsContainClientMessage(turns, commandId)) {
      await this.#queue.markDelivered(commandId);
      this.#appendQueueChanged(command.remoteThreadId);
      this.#scheduleQueuePump(0);
      return;
    }
    if (turns.some(turnIsActive)) {
      this.#scheduleQueuePump(2_000);
      return;
    }
    if (
      !this.#upstreamReady ||
      this.#upstream?.readyState !== WebSocket.OPEN ||
      this.#upstream.bufferedAmount > MAX_BUFFERED_BYTES ||
      this.#pending.size >= MAX_PENDING_RPCS_GLOBAL
    ) {
      this.#scheduleQueuePump(1_000);
      return;
    }
    let preparedParams: RpcObject;
    try {
      preparedParams = await this.#prepareRpcParams(command.method, command.params);
    } catch (cause) {
      await this.#queue.markFailed(commandId, cause instanceof Error ? cause.message : "Invalid queued RPC params");
      this.#appendQueueChanged(command.remoteThreadId);
      this.#scheduleQueuePump(0);
      return;
    }
    await this.#queue.markUncertain(commandId);
    this.#appendQueueChanged(command.remoteThreadId);
    const upstreamId = `codewide:queue-start:${++this.#upstreamCounter}`;
    this.#pending.set(upstreamId, { kind: "queueStart", commandId });
    this.#upstream.send(JSON.stringify({ id: upstreamId, method: command.method, params: preparedParams }));
  }

  async #handleQueueStartResult(commandId: string, response: RpcObject): Promise<void> {
    const threadId = this.#queueThreadId(commandId);
    if ("error" in response) await this.#queue.markFailed(commandId, rpcErrorMessage(response.error));
    else await this.#queue.markDelivered(commandId);
    if (threadId !== null) this.#appendQueueChanged(threadId);
    this.#scheduleQueuePump(0);
  }

  #queueThreadId(commandId: string): string | null {
    return this.#queue.list().find((command) => command.commandId === commandId)?.remoteThreadId ?? null;
  }

  #appendQueueChanged(threadId: string): void {
    this.#appendEvent({
      method: "companion/queue/changed",
      params: { threadId, data: this.#queue.list(threadId) },
    });
  }

  #sendRpcError(client: ClientState, id: unknown, code: number, message: string): void {
    this.#send(client, { type: "rpc", response: { id, error: { code, message } } });
  }

  #send(client: ClientState, message: Record<string, unknown>): void {
    if (client.socket.readyState !== WebSocket.OPEN) return;
    const serialized = JSON.stringify(message);
    client.outbound.send(serialized);
  }

  #closeClient(client: ClientState, code: number, reason: string): void {
    if (client.socket.readyState === WebSocket.OPEN || client.socket.readyState === WebSocket.CONNECTING) {
      client.socket.close(code, reason);
    }
  }
}

function materializeThreadResumeReadModel(result: RpcObject, page: RpcObject): RpcObject {
  const source = asObject(result.thread);
  if (source === null || !Array.isArray(page.data)) throw new Error("Indexed thread history returned an invalid response");
  const activePermissionProfile = asObject(result.activePermissionProfile);
  const sandbox = asObject(result.sandbox);
  const approvalPolicy = typeof result.approvalPolicy === "string"
    ? result.approvalPolicy
    : asObject(result.approvalPolicy)?.granular === undefined ? null : "granular";
  const currentMetadata = asObject(source.codewide) ?? {};
  return {
    ...source,
    // History pages are newest-first for tail latency; the canonical UI read
    // model is chronological and therefore needs no client-side merge/sort.
    turns: [...page.data].reverse(),
    codewide: {
      ...currentMetadata,
      readModelVersion: THREAD_READ_MODEL_VERSION,
      executionSettings: {
        model: typeof result.model === "string" ? result.model : null,
        effort: typeof result.reasoningEffort === "string" ? result.reasoningEffort : null,
        permissions: typeof activePermissionProfile?.id === "string" ? activePermissionProfile.id : null,
        approvalPolicy,
        sandboxPolicy: typeof sandbox?.type === "string" ? sandbox.type : null,
      },
    },
  };
}

function rpcIdKey(id: unknown): string {
  return `${typeof id}:${JSON.stringify(id)}`;
}

function asObject(value: unknown): RpcObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RpcObject : null;
}

function stringValue(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected a string");
  return value;
}

function localRpcOwnerId(client: ClientState): string {
  return client.authorization.deviceId ?? client.id;
}

function rpcErrorMessage(value: unknown): string {
  const error = asObject(value);
  return typeof error?.message === "string" ? error.message : "App Server request failed";
}

function turnsContainClientMessage(turns: unknown[], clientId: string): boolean {
  return turns.some((rawTurn) => {
    const turn = asObject(rawTurn);
    if (!Array.isArray(turn?.items)) return false;
    return turn.items.some((rawItem) => {
      const item = asObject(rawItem);
      return item?.type === "userMessage" && item.clientId === clientId;
    });
  });
}

function turnIsActive(rawTurn: unknown): boolean {
  const status = asObject(rawTurn)?.status;
  return status === "inProgress" || ["active", "inProgress"].includes(String(asObject(status)?.type));
}
