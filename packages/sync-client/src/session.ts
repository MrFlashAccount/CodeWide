import type { ThreadListResponse } from "@codewide/codex-protocol/v0.147.0/v2";

import type { RemoteConnection, SocketFactory, SocketLike, SyncCache, SyncEvent, SyncEventIngress, SyncServerRequest, SyncSnapshotThread } from "./types";
import { restoreSubagentParent } from "./thread-metadata";

type RpcResponse = { id: unknown; result?: unknown; error?: { code: number; message: string } };
type PendingRpc = { resolve(value: unknown): void; reject(error: Error): void; timeout: ReturnType<typeof setTimeout> };
type PendingServerResponse = { resolve(): void; reject(error: Error): void; timeout: ReturnType<typeof setTimeout> };
type LiveWaiter = { resolve(): void; reject(error: Error): void; timeout: ReturnType<typeof setTimeout> };
const MAX_EVENT_BATCH_COUNT = 4_096;
const MAX_EVENT_BATCH_BYTES = 8 * 1024 * 1024;

export class RpcResponseError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
    this.name = "RpcResponseError";
  }
}

export type SyncSessionOptions = {
  connection: RemoteConnection;
  cache: SyncCache;
  socketFactory: SocketFactory;
  onEvents?(connectionId: string, events: SyncEvent[], ingress: SyncEventIngress): void;
  eventPersistenceIntervalMs?: number;
  rpcTimeoutMs?: number;
  longRunningRpcTimeoutMs?: number;
  snapshotRpcTimeoutMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
};

export class SyncSession {
  readonly #connection: RemoteConnection;
  readonly #cache: SyncCache;
  readonly #socketFactory: SocketFactory;
  readonly #onEvents: ((connectionId: string, events: SyncEvent[], ingress: SyncEventIngress) => void) | undefined;
  readonly #eventPersistenceIntervalMs: number;
  readonly #rpcTimeoutMs: number;
  readonly #longRunningRpcTimeoutMs: number;
  readonly #snapshotRpcTimeoutMs: number;
  readonly #reconnectBaseMs: number;
  readonly #reconnectMaxMs: number;
  readonly #pendingRpc = new Map<number, PendingRpc>();
  readonly #pendingServerResponses = new Map<string, PendingServerResponse>();
  readonly #liveWaiters = new Set<LiveWaiter>();
  #socket: SocketLike | undefined;
  #requestId = 0;
  #stopped = true;
  #live = false;
  #snapshotHead: number | null = null;
  #catchUpHead: number | null = null;
  #reconnectAttempt = 0;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  #applyChain = Promise.resolve();
  #eventBatch: Array<{ socket: SocketLike; event: { cursor: number; payload: Record<string, unknown> } }> = [];
  #eventBatchBytes = 0;
  #pendingApplyCount = 0;
  #pendingApplyBytes = 0;
  #eventBatchTimer: ReturnType<typeof setTimeout> | undefined;
  #maximumObservedCursor = 0;
  #lastAckSentCursor = 0;

  constructor(options: SyncSessionOptions) {
    this.#connection = options.connection;
    this.#cache = options.cache;
    this.#socketFactory = options.socketFactory;
    this.#onEvents = options.onEvents;
    this.#eventPersistenceIntervalMs = options.eventPersistenceIntervalMs ?? 8;
    this.#rpcTimeoutMs = options.rpcTimeoutMs ?? 30_000;
    this.#longRunningRpcTimeoutMs = options.longRunningRpcTimeoutMs ?? Math.max(this.#rpcTimeoutMs, 10 * 60_000);
    this.#snapshotRpcTimeoutMs = options.snapshotRpcTimeoutMs ?? Math.max(this.#rpcTimeoutMs, 120_000);
    this.#reconnectBaseMs = options.reconnectBaseMs ?? 500;
    this.#reconnectMaxMs = options.reconnectMaxMs ?? 30_000;
  }

  get connectionId(): string {
    return this.#connection.id;
  }

  start(): void {
    if (!this.#stopped || !this.#connection.enabled) return;
    this.#stopped = false;
    void this.#connect();
  }

  stop(): void {
    this.#stopped = true;
    this.#live = false;
    this.#snapshotHead = null;
    this.#catchUpHead = null;
    if (this.#reconnectTimer !== undefined) clearTimeout(this.#reconnectTimer);
    if (this.#eventBatchTimer !== undefined) clearTimeout(this.#eventBatchTimer);
    this.#reconnectTimer = undefined;
    this.#eventBatchTimer = undefined;
    this.#flushEventBatch();
    this.#socket?.close(1000, "client_stopped");
    this.#socket = undefined;
    this.#rejectPending("Connection stopped");
    this.#rejectLiveWaiters("Connection stopped");
    void this.#cache.setConnectionState(this.#connection.id, "offline");
  }

  async waitUntilLive(timeoutMs = this.#rpcTimeoutMs): Promise<void> {
    if (this.#live && this.#socket !== undefined) return;
    if (this.#stopped) throw new Error("Connection stopped");
    await new Promise<void>((resolve, reject) => {
      const waiter: LiveWaiter = {
        resolve: () => {
          clearTimeout(waiter.timeout);
          this.#liveWaiters.delete(waiter);
          resolve();
        },
        reject: (error) => {
          clearTimeout(waiter.timeout);
          this.#liveWaiters.delete(waiter);
          reject(error);
        },
        timeout: setTimeout(() => {
          this.#liveWaiters.delete(waiter);
          // The session keeps reconnecting after an individual foreground
          // operation gives up waiting. Do not tell the user that recovery
          // itself stopped or failed.
          reject(new Error("Server is still reconnecting. Retry when its status is live; background reconnection will continue."));
        }, timeoutMs),
      };
      this.#liveWaiters.add(waiter);
    });
  }

  async rpc<T>(method: string, params: unknown): Promise<T> {
    const timeoutMs = method === "thread/fork" || method === "companion/workspace/create"
      ? this.#longRunningRpcTimeoutMs
      : this.#rpcTimeoutMs;
    return await this.#rpcWithTimeout<T>(method, params, timeoutMs);
  }

  async #rpcWithTimeout<T>(method: string, params: unknown, timeoutMs: number): Promise<T> {
    if (!this.#live || this.#socket === undefined) throw new Error("Connection is not live");
    const id = ++this.#requestId;
    const response = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pendingRpc.delete(id);
        reject(new Error(`RPC timed out: ${method}`));
      }, timeoutMs);
      this.#pendingRpc.set(id, { resolve: (value) => resolve(value as T), reject, timeout });
    });
    this.#send({ type: "rpc", request: { id, method, params } });
    return await response;
  }

  async respondToServerRequest(id: string | number, result: unknown): Promise<void> {
    if (!this.#live || this.#socket === undefined) throw new Error("Connection is not live");
    const key = rpcIdKey(id);
    if (this.#pendingServerResponses.has(key)) throw new Error("Server request response is already pending");
    const accepted = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pendingServerResponses.delete(key);
        reject(new Error("Server request response timed out"));
      }, this.#rpcTimeoutMs);
      this.#pendingServerResponses.set(key, { resolve, reject, timeout });
    });
    this.#send({ type: "serverResponse", response: { id, result } });
    await accepted;
  }

  async #connect(): Promise<void> {
    if (this.#stopped) return;
    await this.#cache.setConnectionState(this.#connection.id, "connecting");
    const socket = this.#socketFactory(this.#connection);
    this.#socket = socket;
    socket.addEventListener("open", () => {
      void this.#cache.getCursor(this.#connection.id).then((cursor) => {
        if (this.#socket !== socket || this.#stopped) return;
        this.#send({ type: "hello", protocolVersion: 1, cursor });
      });
    });
    socket.addEventListener("message", (event) => {
      const observedAtMs = performance.now();
      const nativeToJsMs = typeof event.receivedAtUnixMs === "number" && Number.isFinite(event.receivedAtUnixMs)
        ? Math.max(0, Date.now() - event.receivedAtUnixMs)
        : undefined;
      this.#onMessage(socket, decodeSocketData(event.data), observedAtMs, nativeToJsMs);
    });
    socket.addEventListener("error", () => {
      if (this.#socket === socket) void this.#cache.setConnectionState(this.#connection.id, "degraded");
    });
    socket.addEventListener("close", () => {
      if (this.#socket !== socket) return;
      this.#socket = undefined;
      this.#live = false;
      this.#snapshotHead = null;
      this.#catchUpHead = null;
      this.#rejectPending("Connection closed");
      if (!this.#stopped) {
        void this.#cache.setConnectionState(this.#connection.id, "offline");
        this.#scheduleReconnect();
      }
    });
  }

  #onMessage(socket: SocketLike, raw: string, observedAtMs: number, nativeToJsMs: number | undefined): void {
    if (this.#socket !== socket || this.#stopped) return;
    let message: Record<string, unknown>;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
      message = parsed as Record<string, unknown>;
    } catch {
      socket.close(1007, "invalid_json");
      return;
    }
    if (message.type === "status") {
      const state = message.status;
      const diagnostic = connectionDiagnostic(message.error);
      if (state === "live") {
        this.#live = true;
        this.#resolveLiveWaiters();
        this.#reconnectAttempt = 0;
        const synchronizing = this.#snapshotHead !== null || this.#catchUpHead !== null;
        void this.#cache.setConnectionState(this.#connection.id, synchronizing ? "syncing" : "live", synchronizing ? undefined : null);
        if (this.#snapshotHead !== null) void this.#loadSnapshot(this.#snapshotHead);
      } else if (state === "reconnecting") {
        // The companion WebSocket can stay open while its App Server upstream
        // reconnects. Treat that transport as unavailable: accepting RPCs in
        // this window makes the UI claim `live` and turns definite upstream
        // downtime into avoidable delivery failures.
        this.#live = false;
        this.#rejectPending("Connection unavailable");
        void this.#cache.setConnectionState(this.#connection.id, "connecting", diagnostic);
      } else if (isConnectionState(state)) {
        this.#live = false;
        this.#rejectPending("Connection unavailable");
        if (state === "authRequired") this.#rejectLiveWaiters(diagnostic ?? "Pairing or access grant required");
        void this.#cache.setConnectionState(this.#connection.id, state, diagnostic ?? (state === "authRequired" ? "Pairing or access grant required" : undefined));
      }
      return;
    }
    if (message.type === "hello") {
      const headCursor = message.headCursor;
      if (!Number.isSafeInteger(headCursor) || (headCursor as number) < 0) {
        socket.close(1008, "invalid_head_cursor");
        return;
      }
      this.#maximumObservedCursor = headCursor as number;
      this.#lastAckSentCursor = 0;
      const pendingRequests = parsePendingServerRequests(message.pendingRequests);
      if (pendingRequests === null) {
        socket.close(1008, "invalid_pending_requests");
        return;
      }
      if (pendingRequests !== undefined) {
        this.#applyChain = this.#applyChain
          .then(() => this.#cache.replacePendingServerRequests(this.#connection.id, pendingRequests))
          .catch((cause: unknown) => {
            void this.#cache.setConnectionState(this.#connection.id, "degraded", errorMessage(cause, "Pending request reconciliation failed"));
            if (this.#socket === socket) socket.close(1011, cause instanceof Error ? cause.message.slice(0, 80) : "pending_request_reconcile_failed");
          });
      }
      if (message.snapshotRequired === true) {
        this.#snapshotHead = headCursor as number;
        this.#catchUpHead = null;
        void this.#cache.setConnectionState(this.#connection.id, "syncing");
        if (this.#live) void this.#loadSnapshot(this.#snapshotHead);
      } else {
        this.#snapshotHead = null;
        this.#catchUpHead = headCursor as number;
      }
      return;
    }
    if (message.type === "rpc") {
      this.#resolveRpc(message.response);
      return;
    }
    if (message.type === "serverResponseAccepted" || message.type === "serverResponseRejected") {
      const id = message.id;
      if (typeof id !== "string" && typeof id !== "number") return;
      const key = rpcIdKey(id);
      const pending = this.#pendingServerResponses.get(key);
      if (pending === undefined) return;
      this.#pendingServerResponses.delete(key);
      clearTimeout(pending.timeout);
      if (message.type === "serverResponseAccepted") pending.resolve();
      else pending.reject(new Error(`Server response rejected: ${String(message.reason ?? "unknown")}`));
      return;
    }
    if (message.type === "event") {
      const cursor = message.cursor;
      const payload = message.payload;
      if (!Number.isSafeInteger(cursor) || payload === null || typeof payload !== "object" || Array.isArray(payload)) {
        socket.close(1008, "invalid_event");
        return;
      }
      const frameBytes = new TextEncoder().encode(raw).byteLength;
      if (this.#pendingApplyCount >= MAX_EVENT_BATCH_COUNT || this.#pendingApplyBytes + frameBytes > MAX_EVENT_BATCH_BYTES) {
        socket.close(1013, "event_backpressure");
        return;
      }
      const event: SyncEvent = { cursor: cursor as number, payload: payload as Record<string, unknown> };
      this.#maximumObservedCursor = Math.max(this.#maximumObservedCursor, event.cursor);
      this.#eventBatch.push({ socket, event });
      this.#onEvents?.(this.#connection.id, [event], {
        observedAtMs,
        decodeDurationMs: Math.max(0, performance.now() - observedAtMs),
        ...(nativeToJsMs === undefined ? {} : { nativeToJsMs }),
      });
      this.#eventBatchBytes += frameBytes;
      this.#pendingApplyCount += 1;
      this.#pendingApplyBytes += frameBytes;
      if (this.#eventBatchTimer === undefined) {
        this.#eventBatchTimer = setTimeout(() => {
          this.#eventBatchTimer = undefined;
          this.#flushEventBatch();
        }, this.#eventPersistenceIntervalMs);
      }
      return;
    }
    if (message.type === "caughtUp") {
      const cursor = message.cursor;
      if (!Number.isSafeInteger(cursor) || cursor !== this.#catchUpHead) {
        socket.close(1008, "invalid_caught_up_cursor");
        return;
      }
      this.#snapshotHead = null;
      this.#catchUpHead = null;
      this.#flushEventBatch();
      this.#applyChain = this.#applyChain.then(async () => {
        if (this.#socket === socket && !this.#stopped) {
          await this.#cache.setConnectionState(this.#connection.id, "live");
        }
      });
    }
  }

  #flushEventBatch(): void {
    if (this.#eventBatch.length === 0) return;
    const batch = this.#eventBatch.splice(0);
    const batchBytes = this.#eventBatchBytes;
    this.#eventBatchBytes = 0;
    const last = batch.at(-1);
    this.#applyChain = this.#applyChain.then(async () => {
      await this.#cache.applyEvents(this.#connection.id, batch.map(({ event }) => event));
      if (last !== undefined && this.#socket === last.socket && !this.#stopped) {
        const durableCursor = await this.#cache.getCursor(this.#connection.id);
        if (
          durableCursor !== null
          && durableCursor >= this.#lastAckSentCursor
          && durableCursor <= this.#maximumObservedCursor
        ) {
          last.socket.send(JSON.stringify({ type: "ack", cursor: durableCursor }));
          this.#lastAckSentCursor = durableCursor;
        }
      }
    }).catch((cause: unknown) => {
      void this.#cache.setConnectionState(this.#connection.id, "degraded", errorMessage(cause, "Local event cache update failed"));
      const currentSocket = this.#socket;
      if (currentSocket !== undefined && currentSocket === last?.socket) {
        currentSocket.close(1011, cause instanceof Error ? cause.message.slice(0, 80) : "cache_apply_failed");
      }
    }).finally(() => {
      this.#pendingApplyCount = Math.max(0, this.#pendingApplyCount - batch.length);
      this.#pendingApplyBytes = Math.max(0, this.#pendingApplyBytes - batchBytes);
    });
  }

  async #loadSnapshot(headCursor: number): Promise<void> {
    if (!this.#live || this.#snapshotHead !== headCursor) return;
    try {
      const loadThreadList = async (archived: boolean): Promise<SyncSnapshotThread[]> => {
        const threads: SyncSnapshotThread[] = [];
        let cursor: string | null = null;
        const seenCursors = new Set<string>();
        do {
          const response: ThreadListResponse = await this.#rpcWithTimeout<ThreadListResponse>("thread/list", {
            cursor,
            limit: 100,
            sortKey: "updated_at",
            sortDirection: "desc",
            archived,
            // Omitting modelProviders scopes thread/list to the App Server's
            // current provider. That hides history created before a provider
            // migration (for example openai -> openai_no_ws). An explicit
            // empty list means all providers.
            modelProviders: [],
            // Snapshot hydration is latency-sensitive. Codex owns state DB
            // backfill; JSONL scan-and-repair must run as an explicit
            // maintenance operation rather than block client recovery.
            useStateDbOnly: true,
          }, this.#snapshotRpcTimeoutMs);
          threads.push(...response.data.map((thread) => ({ thread: restoreSubagentParent(thread), archived })));
          cursor = response.nextCursor;
          if (cursor !== null && seenCursors.has(cursor)) throw new Error("thread/list returned a repeated cursor");
          if (cursor !== null) seenCursors.add(cursor);
        } while (cursor !== null);
        return threads;
      };
      // Active and archived histories have independent cursors. Fetching them
      // concurrently removes an avoidable full network round trip from every
      // cold connection without changing snapshot atomicity.
      // Descendant trees are loaded from the Companion's local parent index
      // when their root is opened. They must not add two full App Server
      // catalog scans to every reconnect snapshot.
      const [activeThreads, archivedThreads] = await Promise.all([
        loadThreadList(false),
        loadThreadList(true),
      ]);
      const threads = [...activeThreads, ...archivedThreads];
      if (this.#snapshotHead !== headCursor) return;
      await this.#cache.applySnapshot(this.#connection.id, threads, headCursor);
      this.#send({ type: "snapshotApplied", cursor: headCursor });
    } catch (cause) {
      // Keep the transport state coarse for the UI, but do not erase the only
      // actionable evidence when a device-specific cache operation fails.
      // React Native forwards this to logcat without serializing thread data.
      console.warn(
        "CodeWide snapshot failed:",
        cause instanceof Error ? `${cause.name}: ${cause.message}` : "unknown error",
      );
      this.#live = false;
      await this.#cache.setConnectionState(this.#connection.id, "degraded", errorMessage(cause, "Snapshot synchronization failed"));
      this.#socket?.close(1011, "snapshot_failed");
    }
  }

  #resolveRpc(value: unknown): void {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return;
    const response = value as RpcResponse;
    if (typeof response.id !== "number") return;
    const pending = this.#pendingRpc.get(response.id);
    if (pending === undefined) return;
    this.#pendingRpc.delete(response.id);
    clearTimeout(pending.timeout);
    if (response.error !== undefined) pending.reject(new RpcResponseError(response.error.code, response.error.message));
    else pending.resolve(response.result);
  }

  #send(message: Record<string, unknown>): void {
    this.#socket?.send(JSON.stringify(message));
  }

  #scheduleReconnect(): void {
    if (this.#stopped || this.#reconnectTimer !== undefined) return;
    const delay = Math.min(this.#reconnectMaxMs, this.#reconnectBaseMs * 2 ** Math.min(this.#reconnectAttempt, 8));
    this.#reconnectAttempt += 1;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined;
      void this.#connect();
    }, delay);
  }

  #rejectPending(message: string): void {
    for (const pending of this.#pendingRpc.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(message));
    }
    this.#pendingRpc.clear();
    for (const pending of this.#pendingServerResponses.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(message));
    }
    this.#pendingServerResponses.clear();
  }

  #resolveLiveWaiters(): void {
    for (const waiter of [...this.#liveWaiters]) waiter.resolve();
  }

  #rejectLiveWaiters(message: string): void {
    for (const waiter of [...this.#liveWaiters]) waiter.reject(new Error(message));
  }
}

function rpcIdKey(id: string | number): string {
  return `${typeof id}:${JSON.stringify(id)}`;
}

function decodeSocketData(data: unknown): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength));
  }
  return String(data);
}

function isConnectionState(value: unknown): value is "offline" | "connecting" | "syncing" | "degraded" | "authRequired" {
  return value === "offline" || value === "connecting" || value === "syncing" || value === "degraded" || value === "authRequired";
}

function connectionDiagnostic(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized === "" ? null : normalized.slice(0, 1_000);
}

function errorMessage(cause: unknown, fallback: string): string {
  if (!(cause instanceof Error)) return fallback;
  const message = cause.message.trim();
  if (message === "") return cause.name === "Error" ? fallback : cause.name;
  return `${cause.name === "Error" ? "" : `${cause.name}: `}${message}`.slice(0, 1_000);
}

function parsePendingServerRequests(value: unknown): SyncServerRequest[] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 1_024) return null;
  const requests: SyncServerRequest[] = [];
  for (const raw of value) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
    const request = raw as Record<string, unknown>;
    const id = request.id;
    const params = request.params;
    if (
      (typeof id !== "string" && typeof id !== "number") ||
      typeof request.method !== "string" ||
      params === null || typeof params !== "object" || Array.isArray(params)
    ) return null;
    requests.push({ id, method: request.method, params: params as Record<string, unknown> });
  }
  return requests;
}
