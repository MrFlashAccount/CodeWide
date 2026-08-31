import {
  MemoryV2OperationStore,
  MemoryV2ProjectionStore,
  SyncV2Session,
  v2SavedServerId,
  type V2OperationStore,
  type V2ProjectionStore,
  type V2SnapshotFrame,
  type V2SocketLike,
  type V2ThreadSummary,
} from "../src/v2/index.js";

type ListenerMap = {
  open: Array<() => void>;
  message: Array<(event: { data: unknown }) => void>;
  close: Array<() => void>;
  error: Array<() => void>;
};

export class FakeV2Socket implements V2SocketLike {
  readyState = 0;
  readonly sent: Record<string, unknown>[] = [];
  readonly closes: Array<{ code?: number; reason?: string }> = [];
  readonly #listeners: ListenerMap = { open: [], message: [], close: [], error: [] };

  addEventListener<T extends keyof ListenerMap>(type: T, listener: ListenerMap[T][number]): void {
    (this.#listeners[type] as Array<typeof listener>).push(listener);
  }
  open(): void {
    this.readyState = 1;
    for (const listener of this.#listeners.open) listener();
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(code?: number, reason?: string): void {
    this.closes.push({
      ...(code === undefined ? {} : { code }),
      ...(reason === undefined ? {} : { reason }),
    });
    this.readyState = 3;
    for (const listener of this.#listeners.close) listener();
  }
  emit(frame: unknown): void {
    for (const listener of this.#listeners.message)
      listener({ data: typeof frame === "string" ? frame : JSON.stringify(frame) });
  }
  emitBinary(): void {
    for (const listener of this.#listeners.message) listener({ data: new Uint8Array([1]) });
  }
  emitError(): void {
    for (const listener of this.#listeners.error) listener();
  }
  listenerCount(type: keyof ListenerMap): number {
    return this.#listeners[type].length;
  }
}

export const savedServerA = v2SavedServerId("saved-server-a");
export const savedServerB = v2SavedServerId("saved-server-b");
export const defaultIntent = {
  catalog: { activeLimit: 2, archivedLimit: 1 },
  currentThread: { threadId: "thread-1", turnLimit: 36 },
} as const;

export function setup(
  projectionStore: V2ProjectionStore = new MemoryV2ProjectionStore(),
  operationStore: V2OperationStore = new MemoryV2OperationStore(),
  savedServerId = savedServerA,
) {
  const socket = new FakeV2Socket();
  const session = new SyncV2Session({
    savedServerId,
    transportLease: { openSync: () => socket },
    intent: defaultIntent,
    projectionStore,
    operationStore,
    requestId: (() => {
      let value = 0;
      return () => `request-${++value}`;
    })(),
    reconnectDelayMs: 60_000,
  });
  return { socket, session };
}

export async function makeLive(
  socket: FakeV2Socket,
  session: SyncV2Session,
  value = snapshot(),
): Promise<void> {
  session.start();
  await waitFor(() => socket.listenerCount("open") > 0);
  socket.open();
  socket.emit(value);
  await waitFor(() => socket.sent.some((frame) => frame.type === "snapshotCommitted"));
  socket.emit({ type: "live", epochId: value.epochId, watermark: value.watermark });
  await waitFor(() => session.state === "live");
}

export function snapshot(
  overrides: {
    sourceGeneration?: string;
    epochId?: string;
    revision?: string;
    active?: V2ThreadSummary[];
    archived?: V2ThreadSummary[];
    currentThread?: V2SnapshotFrame["currentThread"];
    includedTail?: V2SnapshotFrame["includedTail"];
    watermark?: string;
  } = {},
): V2SnapshotFrame {
  const active = overrides.active ?? [thread("thread-1")];
  const archived = overrides.archived ?? [];
  return {
    type: "snapshot",
    version: 2,
    sourceGeneration: overrides.sourceGeneration ?? "1",
    epochId: overrides.epochId ?? "epoch-1",
    revision: overrides.revision ?? "sync-v2-revision:1",
    watermark: overrides.watermark ?? "0",
    scope: {
      active: { limit: 2, returned: active.length, complete: active.length < 2 },
      archived: { limit: 1, returned: archived.length, complete: archived.length < 1 },
    },
    catalog: { active, archived },
    currentThread: overrides.currentThread ?? null,
    pendingRequests: [],
    includedTail: overrides.includedTail ?? [],
    limits: {
      catalogPerPartitionMax: 100,
      turnWindowMax: 36,
      historyPageMax: 100,
      queueMaxEvents: 2_048,
      queueMaxBytes: 4_194_304,
    },
  };
}

export function thread(id: string, overrides: Partial<V2ThreadSummary> = {}): V2ThreadSummary {
  return {
    id,
    parentId: null,
    title: id,
    workspace: "/workspace",
    archived: false,
    state: "idle",
    settings: null,
    createdAt: "2026-08-27T12:00:00Z",
    updatedAt: "2026-08-27T12:00:00Z",
    lastActivityAt: null,
    headTurnId: null,
    ...overrides,
  };
}

export async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("condition not reached");
}
