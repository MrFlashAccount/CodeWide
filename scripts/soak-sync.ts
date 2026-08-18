import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Thread } from "../packages/codex-protocol/src/generated/0.147.0/v2/index.ts";
import {
  MemorySyncCache,
  MultiConnectionSupervisor,
  type RemoteConnection,
  type SocketLike,
} from "../packages/sync-client/src/index.ts";

const durationMs = positiveInteger(process.env.CODEWIDE_SOAK_MS, 24 * 60 * 60 * 1_000);
const connectionCount = positiveInteger(process.env.CODEWIDE_SOAK_CONNECTIONS, 20);
const tickMs = positiveInteger(process.env.CODEWIDE_SOAK_TICK_MS, 100);
const recreateEveryTicks = positiveInteger(process.env.CODEWIDE_SOAK_RECREATE_TICKS, 3_000);
const memoryCeilingBytes = positiveInteger(process.env.CODEWIDE_SOAK_MEMORY_BYTES, 768 * 1024 * 1024);
const artifactPath = path.resolve(process.env.CODEWIDE_SOAK_ARTIFACT ?? "test-results/soak/sync-24h.json");

type ListenerMap = {
  open: Array<() => void>;
  message: Array<(event: { data: unknown }) => void>;
  close: Array<() => void>;
  error: Array<() => void>;
};

type JournalEvent = { cursor: number; payload: Record<string, unknown> };

class SoakServer {
  readonly id: string;
  readonly thread: Thread;
  readonly journal: JournalEvent[] = [];
  cursor = 0;
  socket: SoakSocket | null = null;

  constructor(index: number) {
    this.id = `soak-${index}`;
    this.thread = thread(`${this.id}-thread`);
  }

  connect(): SoakSocket {
    const socket = new SoakSocket(this);
    this.socket = socket;
    queueMicrotask(() => socket.open());
    return socket;
  }

  event(payload: Record<string, unknown>): void {
    const event = { cursor: ++this.cursor, payload };
    this.journal.push(event);
    if (this.journal.length > 512) this.journal.shift();
    this.socket?.emit({ type: "event", ...event });
  }

  drop(): void {
    this.socket?.drop();
  }

  resume(socket: SoakSocket, rawCursor: unknown): void {
    const cursor = typeof rawCursor === "number" && Number.isSafeInteger(rawCursor) ? rawCursor : null;
    const floor = this.journal[0]?.cursor ?? this.cursor + 1;
    const snapshotRequired = cursor === null || cursor < floor - 1 || cursor > this.cursor;
    socket.emit({ type: "hello", protocolVersion: 1, headCursor: this.cursor, snapshotRequired });
    socket.emit({ type: "status", status: "live" });
    if (snapshotRequired) return;
    for (const event of this.journal) if (event.cursor > cursor) socket.emit({ type: "event", ...event });
    socket.emit({ type: "caughtUp", cursor: this.cursor });
  }
}

class SoakSocket implements SocketLike {
  readyState = 0;
  readonly #server: SoakServer;
  readonly #listeners: ListenerMap = { open: [], message: [], close: [], error: [] };

  constructor(server: SoakServer) {
    this.#server = server;
  }

  addEventListener<T extends keyof ListenerMap>(type: T, listener: ListenerMap[T][number]): void {
    (this.#listeners[type] as Array<typeof listener>).push(listener);
  }

  open(): void {
    if (this.readyState === 3) return;
    this.readyState = 1;
    for (const listener of this.#listeners.open) listener();
  }

  send(data: string): void {
    if (this.readyState !== 1) return;
    const message = JSON.parse(data) as Record<string, unknown>;
    if (message.type === "hello") {
      queueMicrotask(() => this.#server.resume(this, message.cursor));
      return;
    }
    if (message.type === "rpc") {
      const request = message.request as Record<string, unknown>;
      queueMicrotask(() => this.emit({
        type: "rpc",
        response: {
          id: request.id,
          result: request.method === "thread/list"
            ? { data: [structuredClone(this.#server.thread)], nextCursor: null, backwardsCursor: null }
            : request.method === "thread/read" ? { thread: structuredClone(this.#server.thread) } : {},
        },
      }));
      return;
    }
    if (message.type === "snapshotApplied") queueMicrotask(() => this.#server.resume(this, message.cursor));
  }

  close(): void {
    this.#finishClose();
  }

  drop(): void {
    this.#finishClose();
  }

  emit(message: Record<string, unknown>): void {
    if (this.readyState !== 1) return;
    const data = JSON.stringify(message);
    for (const listener of this.#listeners.message) listener({ data });
  }

  #finishClose(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    if (this.#server.socket === this) this.#server.socket = null;
    for (const listener of this.#listeners.close) listener();
  }
}

const cache = new MemorySyncCache();
const servers = Array.from({ length: connectionCount }, (_, index) => new SoakServer(index));
const connections: RemoteConnection[] = servers.map((server) => ({
  id: server.id,
  endpoint: `ws://${server.id}/v1/sync`,
  token: `token-${server.id}`,
  enabled: true,
}));
let supervisor = createSupervisor();
let events = 0;
let reconnects = 0;
let recreations = 0;
let maxRssBytes = process.memoryUsage().rss;
const startedAt = Date.now();
let tick = 0;
let finished = false;
let cycleRunning = false;

supervisor.replaceConnections(connections);

const interval = setInterval(() => {
  if (cycleRunning || finished) return;
  cycleRunning = true;
  void cycle()
    .catch((error: unknown) => finish(false, error instanceof Error ? error.message : String(error)))
    .finally(() => {
      cycleRunning = false;
    });
}, tickMs);

process.once("SIGINT", () => void finish(false, "interrupted"));
process.once("SIGTERM", () => void finish(false, "terminated"));

async function cycle(): Promise<void> {
  if (finished) return;
  tick += 1;
  for (const server of servers) {
    server.thread.status = tick % 2 === 0 ? { type: "idle" } : { type: "active", activeFlags: [] };
    server.event({
      method: "thread/status/changed",
      params: { threadId: server.thread.id, status: server.thread.status },
    });
    events += 1;
  }
  if (tick % 200 === 0) {
    const server = servers[(tick / 200) % servers.length];
    if (server !== undefined) {
      const item = server.thread.turns[0]?.items[0];
      if (item?.type === "commandExecution") {
        item.aggregatedOutput = `large-output-${tick}\n${"x".repeat(64 * 1024)}`;
        server.event({ method: "item/completed", params: { threadId: server.thread.id, turnId: "turn", item } });
        events += 1;
      }
    }
  }
  if (tick % 40 === 0) {
    servers[(tick / 40) % servers.length]?.drop();
    reconnects += 1;
  }
  if (tick % recreateEveryTicks === 0) {
    supervisor.stop();
    supervisor = createSupervisor();
    supervisor.replaceConnections(connections);
    recreations += 1;
  }
  if (tick % 10 === 0) await verify();
  if (tick % 100 === 0) await writeArtifact(false, null);
  if (Date.now() - startedAt >= durationMs) await finish(true, null);
}

function createSupervisor(): MultiConnectionSupervisor {
  return new MultiConnectionSupervisor({
    cache,
    socketFactory(connection) {
      const server = servers.find(({ id }) => id === connection.id);
      if (server === undefined) throw new Error(`Unknown soak server ${connection.id}`);
      return server.connect();
    },
  });
}

async function verify(): Promise<void> {
  const rss = process.memoryUsage().rss;
  maxRssBytes = Math.max(maxRssBytes, rss);
  if (rss > memoryCeilingBytes) throw new Error(`RSS ceiling exceeded: ${rss} > ${memoryCeilingBytes}`);
  for (const server of servers) {
    const cursor = await cache.getCursor(server.id);
    if (cursor !== null && cursor > server.cursor) throw new Error(`Cursor escaped server head for ${server.id}`);
    const cached = cache.threads(server.id);
    if (cached.length > 1 || (cached[0] !== undefined && cached[0].id !== server.thread.id)) {
      throw new Error(`Cross-server or cardinality corruption for ${server.id}`);
    }
  }
}

async function finish(passed: boolean, error: string | null): Promise<void> {
  if (finished) return;
  finished = true;
  clearInterval(interval);
  supervisor.stop();
  await verify().catch((cause: unknown) => {
    if (error === null) error = cause instanceof Error ? cause.message : String(cause);
    passed = false;
  });
  await writeArtifact(passed, error);
  process.exitCode = passed ? 0 : 1;
}

async function writeArtifact(passed: boolean, error: string | null): Promise<void> {
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify({
    schemaVersion: 1,
    passed,
    error,
    startedAt,
    updatedAt: Date.now(),
    targetDurationMs: durationMs,
    elapsedMs: Date.now() - startedAt,
    connectionCount,
    events,
    reconnects,
    processRecreations: recreations,
    tickMs,
    recreateEveryTicks,
    rssBytes: process.memoryUsage().rss,
    maxRssBytes,
    memoryCeilingBytes,
  }, null, 2)}\n`, { mode: 0o600 });
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`Expected a positive integer, got ${value}`);
  return parsed;
}

function thread(id: string): Thread {
  return {
    id,
    extra: null,
    sessionId: id,
    forkedFromId: null,
    parentThreadId: null,
    preview: id,
    ephemeral: false,
    section: null,
    sectionEnteredAt: null,
    historyMode: "paginated",
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 1,
    recencyAt: 1,
    status: { type: "idle" },
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
    turns: [{
      id: "turn",
      itemsView: "full",
      status: "completed",
      error: null,
      items: [{
        type: "commandExecution",
        id: "command",
        pluginId: null,
        scriptPath: null,
        command: "soak",
        cwd: "/workspace",
        processId: null,
        source: "agent",
        status: "completed",
        commandActions: [],
        aggregatedOutput: "ready",
        exitCode: 0,
        durationMs: 1,
      }],
      startedAt: 1,
      completedAt: 1,
      durationMs: 1,
    }],
  };
}
