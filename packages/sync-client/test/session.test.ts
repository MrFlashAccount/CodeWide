import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { describe, expect, it } from "vitest";

import { MemorySyncCache, MultiConnectionSupervisor, SyncSession, type SocketLike } from "../src/index.js";

type ListenerMap = {
  open: Array<() => void>;
  message: Array<(event: { data: unknown }) => void>;
  close: Array<() => void>;
  error: Array<() => void>;
};

class FakeSyncSocket implements SocketLike {
  readyState = 0;
  closeCount = 0;
  readonly sent: Record<string, unknown>[] = [];
  readonly #listeners: ListenerMap = { open: [], message: [], close: [], error: [] };

  constructor(
    readonly connectionId: string,
    readonly serverResponseMode: "accept" | "reject" | "ignore" = "accept",
    readonly snapshotResponseMode: "accept" | "reject" = "accept",
    readonly snapshotResponseDelayMs = 0,
  ) {}

  addEventListener<T extends keyof ListenerMap>(type: T, listener: ListenerMap[T][number]): void {
    (this.#listeners[type] as Array<typeof listener>).push(listener);
  }

  open(): void {
    this.readyState = 1;
    for (const listener of this.#listeners.open) listener();
  }

  send(data: string): void {
    const message = JSON.parse(data) as Record<string, unknown>;
    this.sent.push(message);
    queueMicrotask(() => {
      if (message.type === "hello") {
        this.#emit({ type: "hello", protocolVersion: 1, headCursor: 0, snapshotRequired: true });
        this.#emit({ type: "status", status: "live" });
      } else if (message.type === "rpc") {
        const request = message.request as Record<string, unknown>;
        const params = request.params as Record<string, unknown>;
        const respond = () => this.#emit({
            type: "rpc",
            response: this.snapshotResponseMode === "reject" ? {
              id: request.id,
              error: { code: -32000, message: "snapshot unavailable" },
            } : {
              id: request.id,
              result: { data: params.archived === true ? [] : [thread(`${this.connectionId}-thread`)], nextCursor: null, backwardsCursor: null },
            },
          });
        if (this.snapshotResponseDelayMs === 0) respond();
        else setTimeout(respond, this.snapshotResponseDelayMs);
      } else if (message.type === "snapshotApplied") {
        this.#emit({ type: "hello", protocolVersion: 1, headCursor: 0, snapshotRequired: false });
        this.#emit({ type: "caughtUp", cursor: 0 });
      } else if (message.type === "serverResponse" && this.serverResponseMode !== "ignore") {
        const response = message.response as Record<string, unknown>;
        this.#emit(this.serverResponseMode === "accept"
          ? { type: "serverResponseAccepted", id: response.id }
          : { type: "serverResponseRejected", id: response.id, reason: "request no longer pending" });
      }
    });
  }

  close(): void {
    if (this.readyState === 3) return;
    this.closeCount += 1;
    this.readyState = 3;
    for (const listener of this.#listeners.close) listener();
  }

  emitServer(message: Record<string, unknown>): void {
    this.#emit(message);
  }

  #emit(message: Record<string, unknown>): void {
    for (const listener of this.#listeners.message) listener({ data: JSON.stringify(message) });
  }
}

class BlockingEventCache extends MemorySyncCache {
  #release: (() => void) | null = null;
  readonly blocked = new Promise<void>((resolve) => { this.#release = resolve; });

  override async applyEvents(connectionId: string, events: Parameters<MemorySyncCache["applyEvents"]>[1]): Promise<void> {
    await this.blocked;
    await super.applyEvents(connectionId, events);
  }

  release(): void {
    this.#release?.();
    this.#release = null;
  }
}

describe("MemorySyncCache", () => {
  it("never exposes disposable voice threads from snapshots or live events", async () => {
    const cache = new MemorySyncCache();
    const voiceThread = { ...thread("voice-thread"), ephemeral: true };

    await cache.applySnapshot("server", [
      { thread: thread("user-thread"), archived: false },
      { thread: voiceThread, archived: false },
    ], 0);
    await cache.applyEvent("server", {
      cursor: 1,
      payload: { method: "thread/started", params: { thread: { ...voiceThread, id: "voice-thread-live" } } },
    });

    expect(cache.threads("server").map(({ id }) => id)).toEqual(["user-thread"]);
  });
});

describe("MultiConnectionSupervisor", () => {
  it("waits for a live protocol status without polling RPC", async () => {
    const cache = new MemorySyncCache();
    const socket = new FakeSyncSocket("server");
    const session = new SyncSession({
      connection: { id: "server", endpoint: "ws://server/v1/sync", token: "token", enabled: true },
      cache,
      socketFactory: () => socket,
    });
    session.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const live = session.waitUntilLive(100);
    socket.emitServer({ type: "status", status: "live" });

    await expect(live).resolves.toBeUndefined();
    expect(session.connectionId).toBe("server");
    expect(socket.sent).toEqual([]);
    session.stop();
  });

  it("fails live waiters immediately when authorization is required", async () => {
    const cache = new MemorySyncCache();
    const socket = new FakeSyncSocket("server");
    const session = new SyncSession({
      connection: { id: "server", endpoint: "ws://server/v1/sync", token: "token", enabled: true },
      cache,
      socketFactory: () => socket,
    });
    session.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const live = session.waitUntilLive(1_000);
    socket.emitServer({ type: "status", status: "authRequired", error: "grant expired" });

    await expect(live).rejects.toThrow("grant expired");
    session.stop();
  });

  it("persists a transport diagnostic until the connection is healthy", async () => {
    const cache = new MemorySyncCache();
    const socket = new FakeSyncSocket("server");
    const session = new SyncSession({
      connection: { id: "server", endpoint: "ws://server/v1/sync", token: "token", enabled: true },
      cache,
      socketFactory: () => socket,
    });
    session.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    socket.emitServer({ type: "status", status: "connecting", error: "4003:session_expired" });
    await waitFor(() => cache.diagnostic("server") === "4003:session_expired");

    socket.emitServer({ type: "status", status: "live" });
    await waitFor(() => cache.state("server") === "live" && cache.diagnostic("server") === null);
    session.stop();
  });

  it("stays syncing until an incremental replay reaches caughtUp", async () => {
    const cache = new MemorySyncCache();
    await cache.applySnapshot("server", [{ thread: thread("server-thread"), archived: false }], 1);
    const socket = new FakeSyncSocket("server");
    const session = new SyncSession({
      connection: { id: "server", endpoint: "ws://server/v1/sync", token: "token", enabled: true },
      cache,
      socketFactory: () => socket,
    });
    session.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    socket.emitServer({ type: "hello", protocolVersion: 1, headCursor: 2, snapshotRequired: false });
    socket.emitServer({ type: "status", status: "live" });
    await waitFor(() => cache.state("server") === "syncing");

    socket.emitServer({
      type: "event",
      cursor: 2,
      payload: { method: "thread/status/changed", params: { threadId: "server-thread", status: { type: "idle" } } },
    });
    socket.emitServer({ type: "caughtUp", cursor: 2 });

    await waitFor(() => cache.state("server") === "live");
    session.stop();
  });

  it("accepts a native-owned hello without a JS open callback", async () => {
    const cache = new MemorySyncCache();
    await cache.replacePendingServerRequests("native-server", [{
      id: "stale-request",
      method: "item/fileChange/requestApproval",
      params: { threadId: "old-thread" },
    }]);
    const socket = new FakeSyncSocket("native-server");
    const session = new SyncSession({
      connection: { id: "native-server", endpoint: "wss://native.example/v1/sync", token: "token", enabled: true },
      cache,
      socketFactory: () => {
        queueMicrotask(() => {
          socket.emitServer({
            type: "hello",
            protocolVersion: 1,
            headCursor: 0,
            snapshotRequired: false,
            pendingRequests: [{
              id: "current-request",
              method: "item/commandExecution/requestApproval",
              params: { threadId: "current-thread" },
            }],
          });
          socket.emitServer({ type: "status", status: "live" });
          socket.emitServer({ type: "caughtUp", cursor: 0 });
        });
        return socket;
      },
    });

    session.start();
    await waitFor(() => cache.state("native-server") === "live");

    expect(socket.sent.some((message) => message.type === "hello")).toBe(false);
    expect(cache.pendingServerRequests("native-server")).toEqual([{
      id: "current-request",
      method: "item/commandExecution/requestApproval",
      params: { threadId: "current-thread" },
    }]);
    session.stop();
  });

  it("restarts an existing id when endpoint, capability, or TLS pin changes", async () => {
    const cache = new MemorySyncCache();
    const sockets: Array<{ connection: { endpoint: string; token: string; tlsPinSha256?: string }; socket: FakeSyncSocket }> = [];
    const supervisor = new MultiConnectionSupervisor({
      cache,
      socketFactory(connection) {
        const socket = new FakeSyncSocket(connection.id);
        sockets.push({ connection, socket });
        queueMicrotask(() => socket.open());
        return socket;
      },
    });
    const original = { id: "server", endpoint: "wss://old.example/v1/sync", token: "a".repeat(43), enabled: true };
    supervisor.replaceConnections([original]);
    await waitFor(() => cache.state("server") === "live");

    const updated = { ...original, endpoint: "wss://new.example/v1/sync", token: "b".repeat(43), tlsPinSha256: `sha256/${"A".repeat(43)}=` };
    supervisor.replaceConnections([updated]);
    await waitFor(() => sockets.length === 2 && cache.state("server") === "live");

    expect(sockets[0]?.socket.closeCount).toBe(1);
    expect(sockets[1]?.connection).toMatchObject(updated);
    supervisor.stop();
  });

  it("starts and snapshots 100 independent connections without a product cap", async () => {
    const cache = new MemorySyncCache();
    const sockets: FakeSyncSocket[] = [];
    const supervisor = new MultiConnectionSupervisor({
      cache,
      socketFactory(connection) {
        const socket = new FakeSyncSocket(connection.id);
        sockets.push(socket);
        queueMicrotask(() => socket.open());
        return socket;
      },
    });
    const connections = Array.from({ length: 100 }, (_, index) => ({
      id: `server-${index}`,
      endpoint: `ws://server-${index}/v1/sync`,
      token: `token-${index}`,
      enabled: true,
    }));

    supervisor.replaceConnections(connections);
    await waitFor(() => connections.every((connection) => cache.state(connection.id) === "live"));

    expect(sockets).toHaveLength(100);
    expect(connections.every((connection) => cache.threads(connection.id)[0]?.id === `${connection.id}-thread`)).toBe(true);
    expect(sockets.every((socket) => socket.sent
      .filter((message) => message.type === "rpc")
      .map((message) => ((message.request as Record<string, unknown>).params as Record<string, unknown>).archived)
      .join(",") === "false,true,false,true")).toBe(true);
    expect(sockets.every((socket) => socket.sent
      .filter((message) => message.type === "rpc")
      .map((message) => ((message.request as Record<string, unknown>).params as Record<string, unknown>).sourceKinds)
      .map((sourceKinds) => sourceKinds === undefined ? "interactive" : JSON.stringify(sourceKinds))
      .join(",") === 'interactive,interactive,["subAgent"],["subAgent"]')).toBe(true);
    expect(sockets.every((socket) => socket.sent
      .filter((message) => message.type === "rpc")
      .every((message) => ((message.request as Record<string, unknown>).params as Record<string, unknown>).useStateDbOnly === true)
    )).toBe(true);
    supervisor.stop();
  });

  it("preserves loaded turns when a later snapshot contains summaries", async () => {
    const cache = new MemorySyncCache();
    const loaded = thread("thread-1");
    loaded.turns = [{
      id: "turn-1",
      items: [],
      itemsView: "full",
      status: "completed",
      error: null,
      startedAt: 1,
      completedAt: 2,
      durationMs: 1_000,
    }];
    await cache.applySnapshot("server", [{ thread: loaded, archived: false }], 1);
    const summary = { ...thread("thread-1"), preview: "Fresh summary" };
    await cache.applySnapshot("server", [{ thread: summary, archived: false }], 2);

    expect(cache.threads("server")[0]).toMatchObject({ preview: "Fresh summary", turns: loaded.turns });
  });

  it("fails the transport closed when a required snapshot cannot be loaded", async () => {
    const cache = new MemorySyncCache();
    const socket = new FakeSyncSocket("server", "accept", "reject");
    const session = new SyncSession({
      connection: { id: "server", endpoint: "ws://server/v1/sync", token: "token", enabled: true },
      cache,
      socketFactory: () => {
        queueMicrotask(() => socket.open());
        return socket;
      },
      reconnectBaseMs: 60_000,
    });
    session.start();
    await waitFor(() => socket.closeCount === 1);

    expect(cache.state("server")).toBe("offline");
    await expect(session.rpc("thread/list", {})).rejects.toThrow("Connection is not live");
    session.stop();
  });

  it("allows a cold snapshot to outlive the interactive RPC timeout", async () => {
    const cache = new MemorySyncCache();
    const socket = new FakeSyncSocket("server", "accept", "accept", 25);
    const session = new SyncSession({
      connection: { id: "server", endpoint: "ws://server/v1/sync", token: "token", enabled: true },
      cache,
      socketFactory: () => {
        queueMicrotask(() => socket.open());
        return socket;
      },
      rpcTimeoutMs: 10,
      snapshotRpcTimeoutMs: 100,
      reconnectBaseMs: 60_000,
    });
    session.start();
    await waitFor(() => cache.state("server") === "live");

    expect(socket.closeCount).toBe(0);
    expect(cache.threads("server")).toHaveLength(1);
    session.stop();
  });

  it("allows a large thread fork to outlive the interactive RPC timeout", async () => {
    const cache = new MemorySyncCache();
    const socket = new FakeSyncSocket("server", "accept", "accept", 25);
    const session = new SyncSession({
      connection: { id: "server", endpoint: "ws://server/v1/sync", token: "token", enabled: true },
      cache,
      socketFactory: () => {
        queueMicrotask(() => socket.open());
        return socket;
      },
      rpcTimeoutMs: 10,
      longRunningRpcTimeoutMs: 100,
      snapshotRpcTimeoutMs: 100,
      reconnectBaseMs: 60_000,
    });
    session.start();
    await waitFor(() => cache.state("server") === "live");

    await expect(session.rpc("thread/fork", { threadId: "large-thread" })).resolves.toBeDefined();
    session.stop();
  });

  it("applies replay events idempotently before advancing the cache cursor", async () => {
    const cache = new MemorySyncCache();
    await cache.applySnapshot("server", [{ thread: thread("thread-1"), archived: false }], 4);
    const event = {
      cursor: 5,
      payload: { method: "thread/status/changed", params: { threadId: "thread-1", status: { type: "idle" } } },
    };
    await cache.applyEvent("server", event);
    await cache.applyEvent("server", event);
    expect(await cache.getCursor("server")).toBe(5);
    expect(cache.threads("server")[0]?.status).toEqual({ type: "idle" });
  });

  it.each([1, 5, 20, 100])("keeps %i concurrent streams isolated under replay bursts", async (connectionCount) => {
    const cache = new MemorySyncCache();
    const sockets = new Map<string, FakeSyncSocket>();
    const supervisor = new MultiConnectionSupervisor({
      cache,
      socketFactory(connection) {
        const socket = new FakeSyncSocket(connection.id);
        sockets.set(connection.id, socket);
        queueMicrotask(() => socket.open());
        return socket;
      },
    });
    const connections = Array.from({ length: connectionCount }, (_, index) => ({
      id: `stress-${connectionCount}-${index}`,
      endpoint: `ws://stress-${index}/v1/sync`,
      token: `token-${index}`,
      enabled: true,
    }));
    supervisor.replaceConnections(connections);
    await waitFor(() => connections.every((connection) => cache.state(connection.id) === "live"));

    for (const connection of connections) {
      const socket = sockets.get(connection.id);
      if (socket === undefined) throw new Error("Missing stress socket");
      for (let cursor = 1; cursor <= 25; cursor += 1) {
        socket.emitServer({
          type: "event",
          cursor,
          payload: {
            method: "thread/status/changed",
            params: { threadId: `${connection.id}-thread`, status: { type: "idle" } },
          },
        });
      }
    }
    await waitForAllCursors(cache, connections.map(({ id }) => id), 25);

    // Replay the full already-committed window. It must not grow state or leak
    // a thread/status across a connection boundary.
    for (const connection of connections) {
      const socket = sockets.get(connection.id);
      if (socket === undefined) throw new Error("Missing stress socket");
      for (let cursor = 1; cursor <= 25; cursor += 1) {
        socket.emitServer({
          type: "event",
          cursor,
          payload: {
            method: "thread/status/changed",
            params: { threadId: `${connection.id}-thread`, status: { type: "idle" } },
          },
        });
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(connections.every((connection) => {
      const threads = cache.threads(connection.id);
      return threads.length === 1 && threads[0]?.id === `${connection.id}-thread`;
    })).toBe(true);
    supervisor.stop();
  });
});

describe("SyncSession server request responses", () => {
  it("waits for an explicit host acceptance and sends the response once", async () => {
    const cache = new MemorySyncCache();
    const socket = new FakeSyncSocket("server");
    const session = new SyncSession({
      connection: { id: "server", endpoint: "ws://server/v1/sync", token: "token", enabled: true },
      cache,
      socketFactory: () => {
        queueMicrotask(() => socket.open());
        return socket;
      },
      rpcTimeoutMs: 500,
    });
    session.start();
    await waitFor(() => cache.state("server") === "live");

    await session.respondToServerRequest("approval-1", { decision: "accept" });

    expect(socket.sent.filter((message) => message.type === "serverResponse")).toEqual([
      { type: "serverResponse", response: { id: "approval-1", result: { decision: "accept" } } },
    ]);
    session.stop();
  });

  it("surfaces a host rejection without silently treating the approval as delivered", async () => {
    const cache = new MemorySyncCache();
    const socket = new FakeSyncSocket("server", "reject");
    const session = new SyncSession({
      connection: { id: "server", endpoint: "ws://server/v1/sync", token: "token", enabled: true },
      cache,
      socketFactory: () => {
        queueMicrotask(() => socket.open());
        return socket;
      },
      rpcTimeoutMs: 500,
    });
    session.start();
    await waitFor(() => cache.state("server") === "live");

    await expect(session.respondToServerRequest(17, { decision: "decline" })).rejects.toThrow("request no longer pending");
    session.stop();
  });
});

describe("SyncSession upstream lifecycle", () => {
  it("fails closed when caughtUp does not match the latest hello head", async () => {
    const cache = new MemorySyncCache();
    const socket = new FakeSyncSocket("server");
    const session = new SyncSession({
      connection: { id: "server", endpoint: "ws://server/v1/sync", token: "token", enabled: true },
      cache,
      socketFactory: () => {
        queueMicrotask(() => {
          socket.emitServer({ type: "hello", protocolVersion: 1, headCursor: 7, snapshotRequired: false });
          socket.emitServer({ type: "status", status: "live" });
          socket.emitServer({ type: "caughtUp", cursor: 6 });
        });
        return socket;
      },
      reconnectBaseMs: 60_000,
    });

    session.start();
    await waitFor(() => socket.closeCount === 1);

    expect(cache.state("server")).toBe("offline");
    session.stop();
  });

  it("stops accepting RPCs while the companion reconnects its App Server", async () => {
    const cache = new MemorySyncCache();
    const socket = new FakeSyncSocket("server");
    const session = new SyncSession({
      connection: { id: "server", endpoint: "ws://server/v1/sync", token: "token", enabled: true },
      cache,
      socketFactory: () => {
        queueMicrotask(() => socket.open());
        return socket;
      },
    });
    session.start();
    await waitFor(() => cache.state("server") === "live");
    const snapshotRpcCount = socket.sent.filter((message) => message.type === "rpc").length;

    socket.emitServer({ type: "status", status: "reconnecting" });
    await waitFor(() => cache.state("server") === "connecting");

    await expect(session.rpc("thread/list", {})).rejects.toThrow("Connection is not live");
    expect(socket.sent.filter((message) => message.type === "rpc")).toHaveLength(snapshotRpcCount);
    session.stop();
  });

  it("rejects an already pending RPC as soon as the upstream becomes unavailable", async () => {
    const cache = new MemorySyncCache();
    const socket = new FakeSyncSocket("server");
    const session = new SyncSession({
      connection: { id: "server", endpoint: "ws://server/v1/sync", token: "token", enabled: true },
      cache,
      socketFactory: () => {
        queueMicrotask(() => socket.open());
        return socket;
      },
      rpcTimeoutMs: 30_000,
    });
    session.start();
    await waitFor(() => cache.state("server") === "live");

    const pending = session.rpc("thread/read", { threadId: "thread" });
    socket.emitServer({ type: "status", status: "reconnecting" });

    await expect(pending).rejects.toThrow("Connection unavailable");
    session.stop();
  });

  it("surfaces authRequired without closing or starting a reconnect loop", async () => {
    const cache = new MemorySyncCache();
    const socket = new FakeSyncSocket("server");
    let socketCount = 0;
    const session = new SyncSession({
      connection: { id: "server", endpoint: "ws://server/v1/sync", token: "token", enabled: true },
      cache,
      socketFactory: () => {
        socketCount += 1;
        queueMicrotask(() => socket.open());
        return socket;
      },
      reconnectBaseMs: 5,
    });
    session.start();
    await waitFor(() => cache.state("server") === "live");

    socket.emitServer({ type: "status", status: "authRequired" });
    await waitFor(() => cache.state("server") === "authRequired");
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(socketCount).toBe(1);
    expect(socket.closeCount).toBe(0);
    await expect(session.rpc("thread/list", {})).rejects.toThrow("Connection is not live");
    session.stop();
  });
});

describe("SyncSession event batching", () => {
  it("delivers live events before a slow durable write finishes", async () => {
    const cache = new BlockingEventCache();
    const socket = new FakeSyncSocket("server");
    const observed: Array<Record<string, unknown>> = [];
    const session = new SyncSession({
      connection: { id: "server", endpoint: "ws://server/v1/sync", token: "token", enabled: true },
      cache,
      socketFactory: () => {
        queueMicrotask(() => socket.open());
        return socket;
      },
      onEvents: (_connectionId, events) => observed.push(...events.map((event) => event.payload)),
      eventPersistenceIntervalMs: 500,
    });
    session.start();
    await waitFor(() => cache.state("server") === "live");
    const payload = { method: "item/agentMessage/delta", params: { threadId: "server-thread", turnId: "turn", itemId: "agent", delta: "hello" } };

    socket.emitServer({ type: "event", cursor: 1, payload });

    expect(observed).toEqual([payload]);
    expect(await cache.getCursor("server")).toBe(0);
    cache.release();
    session.stop();
  });

  it("cannot return to live after stop while a durable event write is pending", async () => {
    const cache = new BlockingEventCache();
    const socket = new FakeSyncSocket("server");
    const session = new SyncSession({
      connection: { id: "server", endpoint: "ws://server/v1/sync", token: "token", enabled: true },
      cache,
      socketFactory: () => {
        queueMicrotask(() => socket.open());
        return socket;
      },
    });
    session.start();
    await waitFor(() => cache.state("server") === "live");

    socket.emitServer({ type: "hello", protocolVersion: 1, headCursor: 1, snapshotRequired: false });
    socket.emitServer({
      type: "event",
      cursor: 1,
      payload: { method: "thread/status/changed", params: { threadId: "server-thread", status: { type: "idle" } } },
    });
    socket.emitServer({ type: "caughtUp", cursor: 1 });
    session.stop();
    cache.release();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(cache.state("server")).toBe("offline");
  });

  it("commits a burst in one cache emission and acknowledges only the durable head", async () => {
    const cache = new MemorySyncCache();
    const socket = new FakeSyncSocket("server");
    const session = new SyncSession({
      connection: { id: "server", endpoint: "ws://server/v1/sync", token: "token", enabled: true },
      cache,
      socketFactory: () => {
        queueMicrotask(() => socket.open());
        return socket;
      },
    });
    session.start();
    await waitFor(() => cache.state("server") === "live");
    let emissions = 0;
    const unsubscribe = cache.subscribe(() => { emissions += 1; });

    for (let cursor = 1; cursor <= 3; cursor += 1) {
      socket.emitServer({
        type: "event",
        cursor,
        payload: { method: "thread/status/changed", params: { threadId: "server-thread", status: { type: "idle" } } },
      });
    }
    await waitForCursor(cache, "server", 3);

    expect(emissions).toBe(1);
    expect(socket.sent.filter((message) => message.type === "ack")).toEqual([{ type: "ack", cursor: 3 }]);
    unsubscribe();
    session.stop();
  });

  it("never regresses an acknowledgement when native replay delivers a stale frame", async () => {
    const cache = new MemorySyncCache();
    await cache.applySnapshot("server", [{ thread: thread("server-thread"), archived: false }], 5);
    const socket = new FakeSyncSocket("server");
    const session = new SyncSession({
      connection: { id: "server", endpoint: "ws://server/v1/sync", token: "token", enabled: true },
      cache,
      socketFactory: () => {
        queueMicrotask(() => {
          socket.emitServer({ type: "hello", protocolVersion: 1, headCursor: 5, snapshotRequired: false });
          socket.emitServer({ type: "status", status: "live" });
          socket.emitServer({ type: "caughtUp", cursor: 5 });
        });
        return socket;
      },
    });
    session.start();
    await waitFor(() => cache.state("server") === "live");

    socket.emitServer({
      type: "event",
      cursor: 4,
      payload: { method: "thread/status/changed", params: { threadId: "server-thread", status: { type: "idle" } } },
    });
    await waitFor(() => socket.sent.some((message) => message.type === "ack"));

    expect(socket.sent.filter((message) => message.type === "ack")).toEqual([{ type: "ack", cursor: 5 }]);
    session.stop();
  });

  it("fails closed before an event burst can grow the JS batch without bound", async () => {
    const cache = new MemorySyncCache();
    const socket = new FakeSyncSocket("server");
    const session = new SyncSession({
      connection: { id: "server", endpoint: "ws://server/v1/sync", token: "token", enabled: true },
      cache,
      socketFactory: () => {
        queueMicrotask(() => socket.open());
        return socket;
      },
      reconnectBaseMs: 60_000,
    });
    session.start();
    await waitFor(() => cache.state("server") === "live");

    for (let cursor = 1; cursor <= 4_097; cursor += 1) {
      socket.emitServer({
        type: "event",
        cursor,
        payload: { method: "thread/status/changed", params: { threadId: "server-thread", status: { type: "idle" } } },
      });
    }

    expect(socket.closeCount).toBe(1);
    await waitForCursor(cache, "server", 4_096);
    session.stop();
  });

  it("bounds events already queued behind a slow durable cache write", async () => {
    const cache = new BlockingEventCache();
    const socket = new FakeSyncSocket("server");
    const session = new SyncSession({
      connection: { id: "server", endpoint: "ws://server/v1/sync", token: "token", enabled: true },
      cache,
      socketFactory: () => {
        queueMicrotask(() => socket.open());
        return socket;
      },
      reconnectBaseMs: 60_000,
    });
    session.start();
    await waitFor(() => cache.state("server") === "live");

    for (let cursor = 1; cursor <= 3_000; cursor += 1) {
      socket.emitServer({
        type: "event",
        cursor,
        payload: { method: "thread/status/changed", params: { threadId: "server-thread", status: { type: "idle" } } },
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
    for (let cursor = 3_001; cursor <= 4_097; cursor += 1) {
      socket.emitServer({
        type: "event",
        cursor,
        payload: { method: "thread/status/changed", params: { threadId: "server-thread", status: { type: "idle" } } },
      });
    }

    expect(socket.closeCount).toBe(1);
    cache.release();
    await waitForCursor(cache, "server", 4_096);
    session.stop();
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for supervisor state");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function waitForCursor(cache: MemorySyncCache, connectionId: string, cursor: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (await cache.getCursor(connectionId) !== cursor) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for sync cursor");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function waitForAllCursors(cache: MemorySyncCache, connectionIds: string[], cursor: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await Promise.all(connectionIds.map((id) => cache.getCursor(id)))).every((value) => value === cursor)) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for concurrent sync cursors");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function thread(id: string): Thread {
  return {
    id,
    extra: null,
    sessionId: id,
    forkedFromId: null,
    parentThreadId: null,
    preview: `Preview for ${id}`,
    ephemeral: false,
    section: null,
    sectionEnteredAt: null,
    historyMode: "paginated",
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 2,
    recencyAt: 2,
    status: { type: "notLoaded" },
    path: null,
    cwd: "/workspace",
    cliVersion: "0.147.0",
    source: "appServer",
    canAcceptDirectInput: null,
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: id,
    turns: [],
  };
}
