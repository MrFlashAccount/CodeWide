import {
  V2_PROTOCOL_LIMITS,
  type SyncV2Session,
  type V2OperationStore,
  type V2OpenIntent,
  type V2ProjectionStore,
} from "@codewide/sync-client/v2";

import { ProjectionResource } from "../../application/resources/projectionResource";

interface Entry {
  currentThreadId: string | null;
  release(): Promise<void>;
  resource: ProjectionResource;
  session: SyncV2Session;
}

export type SyncSessionFactory = (
  savedServerId: string,
  projectionStore: V2ProjectionStore,
  operationStore: V2OperationStore,
  currentThreadId: string | null,
) => Promise<{ release(): Promise<void>; session: SyncV2Session }>;

export class SyncSessionRegistry {
  readonly #projectionStore: V2ProjectionStore;
  readonly #operationStore: V2OperationStore;
  readonly #createSession: SyncSessionFactory;
  readonly #entries = new Map<string, Promise<Entry>>();

  constructor(
    projectionStore: V2ProjectionStore,
    operationStore: V2OperationStore,
    createSession: SyncSessionFactory,
  ) {
    this.#projectionStore = projectionStore;
    this.#operationStore = operationStore;
    this.#createSession = createSession;
  }

  async open(savedServerId: string, currentThreadId: string | null = null): Promise<Entry> {
    let entry = this.#entries.get(savedServerId);
    if (entry === undefined) {
      entry = this.#create(savedServerId, currentThreadId);
    } else if (currentThreadId !== null) {
      entry = entry.then(
        (current) => {
          if (current.currentThreadId === currentThreadId) return current;
          current.currentThreadId = currentThreadId;
          current.session.updateIntent(intent(currentThreadId));
          return current;
        },
        () => this.#create(savedServerId, currentThreadId),
      );
    }
    return this.#track(savedServerId, entry);
  }

  async #create(savedServerId: string, currentThreadId: string | null): Promise<Entry> {
    const created = await this.#createSession(
      savedServerId,
      this.#projectionStore,
      this.#operationStore,
      currentThreadId,
    );
    const resource = new ProjectionResource(created.session);
    resource.start();
    return { ...created, currentThreadId, resource };
  }

  async #track(savedServerId: string, entry: Promise<Entry>): Promise<Entry> {
    this.#entries.set(savedServerId, entry);
    void entry.catch(() => {
      if (this.#entries.get(savedServerId) === entry) this.#entries.delete(savedServerId);
    });
    return entry;
  }

  reconnect(savedServerId: string): void {
    const entry = this.#entries.get(savedServerId);
    if (entry !== undefined)
      void entry.then(({ session }) => session.reconnect()).catch(() => undefined);
  }

  /** Releases one saved-server session before its local authority is purged. */
  async close(savedServerId: string): Promise<void> {
    const entry = this.#entries.get(savedServerId);
    this.#entries.delete(savedServerId);
    if (entry === undefined) return;
    const current = await entry.catch(() => null);
    if (current === null) return;
    current.resource.dispose();
    await current.release();
  }

  async closeAll(): Promise<void> {
    const entries = [...this.#entries.values()];
    this.#entries.clear();
    await Promise.all(
      entries.map(async (entry) => {
        const current = await entry.catch(() => null);
        if (current === null) return;
        current.resource.dispose();
        await current.release();
      }),
    );
  }
}

function intent(currentThreadId: string | null): V2OpenIntent {
  return {
    catalog: { activeLimit: 40, archivedLimit: 40 },
    currentThread:
      currentThreadId === null
        ? null
        : { threadId: currentThreadId, turnLimit: V2_PROTOCOL_LIMITS.turnWindowMax },
  };
}
