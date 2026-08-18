import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";

import type { RemoteConnectionState, SyncCache, SyncEvent, SyncServerRequest, SyncSnapshotThread } from "./types";
import { applyThreadEvent } from "./thread-events";

type ConnectionData = {
  cursor: number | null;
  state: RemoteConnectionState;
  diagnostic: string | null;
  threads: Map<string, Thread>;
  pendingServerRequests: Map<string, SyncServerRequest>;
};

export class MemorySyncCache implements SyncCache {
  readonly #connections = new Map<string, ConnectionData>();
  readonly #listeners = new Set<() => void>();

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async getCursor(connectionId: string): Promise<number | null> {
    return this.#data(connectionId).cursor;
  }

  async applySnapshot(connectionId: string, threads: SyncSnapshotThread[], cursor: number): Promise<void> {
    const data = this.#data(connectionId);
    data.threads = new Map(threads.filter(({ thread }) => !thread.ephemeral).map(({ thread }) => {
      const cached = data.threads.get(thread.id);
      const merged = preserveCachedTurns(thread, cached);
      return [thread.id, structuredClone(merged)];
    }));
    data.cursor = cursor;
    this.#emit();
  }

  async replacePendingServerRequests(connectionId: string, requests: SyncServerRequest[]): Promise<void> {
    this.#data(connectionId).pendingServerRequests = new Map(requests.map((request) => [requestKey(request.id), structuredClone(request)]));
    this.#emit();
  }

  async applyEvent(connectionId: string, event: SyncEvent): Promise<void> {
    await this.applyEvents(connectionId, [event]);
  }

  async applyEvents(connectionId: string, events: SyncEvent[]): Promise<void> {
    const data = this.#data(connectionId);
    let changed = false;
    for (const event of events) {
      if (data.cursor !== null && event.cursor <= data.cursor) continue;
      if (data.cursor !== null && event.cursor !== data.cursor + 1) throw new Error("Non-contiguous sync cursor");
      applyPayload(data.threads, data.pendingServerRequests, event.payload);
      data.cursor = event.cursor;
      changed = true;
    }
    if (changed) this.#emit();
  }

  async setConnectionState(connectionId: string, state: RemoteConnectionState, diagnostic?: string | null): Promise<void> {
    const data = this.#data(connectionId);
    data.state = state;
    if (state === "live") data.diagnostic = null;
    else if (diagnostic !== undefined) data.diagnostic = diagnostic;
    this.#emit();
  }

  state(connectionId: string): RemoteConnectionState {
    return this.#data(connectionId).state;
  }

  diagnostic(connectionId: string): string | null {
    return this.#data(connectionId).diagnostic;
  }

  threads(connectionId: string): Thread[] {
    return [...this.#data(connectionId).threads.values()].sort(
      (left, right) => (right.recencyAt ?? right.updatedAt) - (left.recencyAt ?? left.updatedAt),
    );
  }

  pendingServerRequests(connectionId: string): SyncServerRequest[] {
    return [...this.#data(connectionId).pendingServerRequests.values()];
  }

  #data(connectionId: string): ConnectionData {
    let data = this.#connections.get(connectionId);
    if (data === undefined) {
      data = { cursor: null, state: "offline", diagnostic: null, threads: new Map(), pendingServerRequests: new Map() };
      this.#connections.set(connectionId, data);
    }
    return data;
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}

function requestKey(id: string | number): string {
  return `${typeof id}:${JSON.stringify(id)}`;
}

export function preserveCachedTurns(summary: Thread, cached: Thread | undefined): Thread {
  if (summary.turns.length !== 0 || cached === undefined || cached.turns.length === 0) return summary;
  return { ...summary, turns: cached.turns };
}

const USER_SERVER_REQUESTS = new Set([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/tool/requestUserInput",
  "mcpServer/elicitation/request",
  "item/permissions/requestApproval",
]);

function applyPayload(
  threads: Map<string, Thread>,
  pendingServerRequests: Map<string, SyncServerRequest>,
  payload: Record<string, unknown>,
): void {
  const method = payload.method;
  const params = asObject(payload.params);
  if (typeof method !== "string" || params === null) return;
  if (method === "serverRequest/resolved") {
    const id = params.requestId;
    if (typeof id === "string" || typeof id === "number") pendingServerRequests.delete(requestKey(id));
    return;
  }
  const requestId = payload.id;
  if (USER_SERVER_REQUESTS.has(method) && (typeof requestId === "string" || typeof requestId === "number")) {
    pendingServerRequests.set(requestKey(requestId), { id: requestId, method, params: structuredClone(params) });
  }
  if (method === "thread/started") {
    const thread = asThread(params.thread);
    if (thread !== null && !thread.ephemeral) threads.set(thread.id, structuredClone(thread));
    return;
  }
  const threadId = typeof params.threadId === "string" ? params.threadId : null;
  if (threadId === null) return;
  if (method === "thread/deleted" || method === "thread/archived") {
    threads.delete(threadId);
    return;
  }
  const thread = threads.get(threadId);
  if (thread === undefined) return;
  applyThreadEvent(thread, payload);
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asThread(value: unknown): Thread | null {
  const object = asObject(value);
  return object !== null && typeof object.id === "string" ? (object as Thread) : null;
}
