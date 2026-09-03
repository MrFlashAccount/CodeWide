import {
  SyncV2RequestError,
  V2_PROTOCOL_LIMITS,
  type SyncV2Session,
  type V2OperationStore,
  type V2ProjectionStore,
} from "@codewide/sync-client/v2";

import { ProjectionResource } from "../../application/resources/projectionResource";

interface Entry {
  closed: boolean;
  currentThreadId: string | null;
  requestedThreadId: string | null;
  release(): Promise<void>;
  resource: ProjectionResource;
  session: SyncV2Session;
  watchChain: Promise<void>;
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
  readonly #resources = new Map<string, ProjectionResource>();

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
    let pending = this.#entries.get(savedServerId);
    if (pending === undefined) {
      pending = this.#create(savedServerId, currentThreadId);
      this.#entries.set(savedServerId, pending);
      void pending.catch(() => {
        if (this.#entries.get(savedServerId) === pending) this.#entries.delete(savedServerId);
      });
    }
    const entry = await pending;
    const needsThreadRequest =
      currentThreadId !== null &&
      entry.requestedThreadId !== currentThreadId &&
      (entry.currentThreadId !== currentThreadId || entry.requestedThreadId !== null);
    if (needsThreadRequest) {
      entry.requestedThreadId = currentThreadId;
      entry.resource.beginRequestedThread(currentThreadId);
      entry.watchChain = entry.watchChain.then(async () => {
        if (entry.closed || entry.requestedThreadId !== currentThreadId) return;
        if (entry.currentThreadId === currentThreadId) {
          entry.requestedThreadId = null;
          entry.resource.confirmRequestedThread(currentThreadId);
          return;
        }
        try {
          await entry.session.watchThread(currentThreadId, V2_PROTOCOL_LIMITS.turnWindowMax);
          if (entry.closed) return;
          entry.currentThreadId = currentThreadId;
          if (entry.requestedThreadId !== currentThreadId) return;
          entry.requestedThreadId = null;
          entry.resource.confirmRequestedThread(currentThreadId);
        } catch (cause: unknown) {
          if (entry.closed) return;
          if (entry.requestedThreadId === currentThreadId) {
            entry.requestedThreadId = null;
            entry.resource.failRequestedThread(currentThreadId, threadWatchFailureMessage(cause));
          }
          if (!(cause instanceof SyncV2RequestError)) {
            entry.currentThreadId = null;
            entry.session.reconnect();
          }
        }
      });
    }
    return entry;
  }

  async #create(savedServerId: string, currentThreadId: string | null): Promise<Entry> {
    const resource = this.resource(savedServerId);
    if (currentThreadId !== null) resource.beginRequestedThread(currentThreadId);
    let created: Awaited<ReturnType<SyncSessionFactory>>;
    try {
      created = await this.#createSession(
        savedServerId,
        this.#projectionStore,
        this.#operationStore,
        currentThreadId,
      );
    } catch (cause: unknown) {
      if (currentThreadId !== null)
        resource.failRequestedThread(currentThreadId, threadWatchFailureMessage(cause));
      throw cause;
    }
    try {
      resource.attach(created.session);
    } catch (cause: unknown) {
      await created.release().catch(() => undefined);
      throw cause;
    }
    return {
      ...created,
      closed: false,
      currentThreadId,
      requestedThreadId: null,
      resource,
      watchChain: Promise.resolve(),
    };
  }

  resource(savedServerId: string): ProjectionResource {
    let resource = this.#resources.get(savedServerId);
    if (resource !== undefined) return resource;
    resource = new ProjectionResource(savedServerId, this.#projectionStore, this.#operationStore);
    resource.start();
    this.#resources.set(savedServerId, resource);
    return resource;
  }

  reconnect(savedServerId: string): void {
    const entry = this.#entries.get(savedServerId);
    if (entry !== undefined)
      void entry
        .then((value) => {
          const { session } = value;
          return session.reconnect();
        })
        .catch(() => undefined);
  }

  /** Releases one saved-server session before its local authority is purged. */
  async close(savedServerId: string): Promise<void> {
    const entry = this.#entries.get(savedServerId);
    this.#entries.delete(savedServerId);
    const resource = this.#resources.get(savedServerId);
    this.#resources.delete(savedServerId);
    resource?.dispose();
    if (entry === undefined) return;
    const current = await entry.catch(() => null);
    if (current === null) return;
    current.closed = true;
    current.resource.dispose();
    await current.release();
  }

  async closeAll(): Promise<void> {
    const entries = [...this.#entries.values()];
    this.#entries.clear();
    for (const resource of this.#resources.values()) resource.dispose();
    this.#resources.clear();
    await Promise.all(
      entries.map(async (entry) => {
        const current = await entry.catch(() => null);
        if (current === null) return;
        current.closed = true;
        current.resource.dispose();
        await current.release();
      }),
    );
  }
}

function threadWatchFailureMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Could not open this conversation";
}
