import { SyncSession, type SyncSessionOptions } from "./session";
import type { RemoteConnection, SocketFactory, SyncCache, SyncEvent } from "./types";

export class MultiConnectionSupervisor {
  readonly #cache: SyncCache;
  readonly #socketFactory: SocketFactory;
  readonly #onEvents: ((connectionId: string, events: SyncEvent[]) => void) | undefined;
  readonly #eventPersistenceIntervalMs: number | undefined;
  readonly #sessions = new Map<string, SyncSession>();
  readonly #connectionFingerprints = new Map<string, string>();

  constructor(options: {
    cache: SyncCache;
    socketFactory: SocketFactory;
    onEvents?(connectionId: string, events: SyncEvent[]): void;
    eventPersistenceIntervalMs?: number;
  }) {
    this.#cache = options.cache;
    this.#socketFactory = options.socketFactory;
    this.#onEvents = options.onEvents;
    this.#eventPersistenceIntervalMs = options.eventPersistenceIntervalMs;
  }

  replaceConnections(connections: RemoteConnection[]): void {
    const enabled = connections.filter((connection) => connection.enabled);
    const wanted = new Map(enabled.map((connection) => [connection.id, connectionFingerprint(connection)]));
    for (const [id, session] of this.#sessions) {
      if (wanted.get(id) !== this.#connectionFingerprints.get(id)) {
        session.stop();
        this.#sessions.delete(id);
        this.#connectionFingerprints.delete(id);
      }
    }
    for (const connection of enabled) {
      if (this.#sessions.has(connection.id)) continue;
      const options: SyncSessionOptions = {
        connection,
        cache: this.#cache,
        socketFactory: this.#socketFactory,
        ...(this.#onEvents === undefined ? {} : { onEvents: this.#onEvents }),
        ...(this.#eventPersistenceIntervalMs === undefined ? {} : { eventPersistenceIntervalMs: this.#eventPersistenceIntervalMs }),
      };
      const session = new SyncSession(options);
      this.#sessions.set(connection.id, session);
      this.#connectionFingerprints.set(connection.id, connectionFingerprint(connection));
      session.start();
    }
  }

  session(connectionId: string): SyncSession | undefined {
    return this.#sessions.get(connectionId);
  }

  stop(): void {
    for (const session of this.#sessions.values()) session.stop();
    this.#sessions.clear();
    this.#connectionFingerprints.clear();
  }
}

function connectionFingerprint(connection: RemoteConnection): string {
  return JSON.stringify([connection.endpoint, connection.token, connection.tlsPinSha256 ?? null]);
}
