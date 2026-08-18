import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";

import { threadKey } from "./identity";
import type { ConnectionId, ConnectionProfile, DomainSnapshot, NormalizedThread } from "./model";
import { normalizeThread } from "./normalize";

export class DomainStore {
  readonly #connections = new Map<ConnectionId, ConnectionProfile>();
  readonly #threads = new Map<string, NormalizedThread>();

  upsertConnection(connection: ConnectionProfile): void {
    this.#connections.set(connection.id, connection);
  }

  removeConnection(connectionId: ConnectionId): void {
    this.#connections.delete(connectionId);
    for (const [key, thread] of this.#threads) {
      if (thread.connectionId === connectionId) {
        this.#threads.delete(key);
      }
    }
  }

  upsertThread(connectionId: ConnectionId, thread: Thread): NormalizedThread {
    if (!this.#connections.has(connectionId)) {
      throw new Error(`Unknown connection: ${connectionId}`);
    }
    const normalized = normalizeThread(connectionId, thread);
    this.#threads.set(normalized.key, normalized);
    return normalized;
  }

  getThread(connectionId: ConnectionId, remoteThreadId: string): NormalizedThread | undefined {
    return this.#threads.get(threadKey(connectionId, remoteThreadId));
  }

  threadsForConnection(connectionId: ConnectionId): NormalizedThread[] {
    return [...this.#threads.values()]
      .filter((thread) => thread.connectionId === connectionId)
      .sort(compareThreads);
  }

  aggregatedThreads(): NormalizedThread[] {
    return [...this.#threads.values()].sort(compareThreads);
  }

  snapshot(): DomainSnapshot {
    return {
      connections: [...this.#connections.values()].sort(
        (left, right) => left.sortOrder - right.sortOrder,
      ),
      threads: this.aggregatedThreads(),
    };
  }
}

function compareThreads(left: NormalizedThread, right: NormalizedThread): number {
  return (right.recencyAt ?? right.updatedAt) - (left.recencyAt ?? left.updatedAt);
}
