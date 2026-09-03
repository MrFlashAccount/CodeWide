import type {
  SyncV2Session,
  SyncV2SessionSnapshot,
  V2OperationStore,
  V2ProjectionChange,
  V2ProjectionStore,
} from "@codewide/sync-client/v2";
import { v2SavedServerId } from "@codewide/sync-client/v2";

import { ObservableResource } from "./resource";
import {
  ProjectionRefreshActivity,
  type ProjectionRefreshState,
} from "./projectionRefreshActivity";

const EMPTY: SyncV2SessionSnapshot = {
  operations: [],
  projections: { live: null, retained: null },
  state: "offline",
  version: 0,
};

export type RequestedThreadAuthority =
  | { message: null; status: "idle"; threadId: null }
  | { message: null; status: "loading" | "ready"; threadId: string }
  | { message: string; status: "error"; threadId: string };

const NO_REQUESTED_THREAD: RequestedThreadAuthority = {
  message: null,
  status: "idle",
  threadId: null,
};

export class ProjectionResource extends ObservableResource<SyncV2SessionSnapshot> {
  readonly #savedServerId: string;
  readonly #projectionStore: V2ProjectionStore;
  readonly #operationStore: V2OperationStore;
  #session: SyncV2Session | null = null;
  #unsubscribes: Array<() => void> = [];
  readonly #changeListeners = new Set<(change: V2ProjectionChange) => void>();
  readonly #refreshActivity = new ProjectionRefreshActivity();
  #sourceGeneration = 0;
  #refreshGeneration = 0;
  #requestedThread: RequestedThreadAuthority = NO_REQUESTED_THREAD;

  constructor(
    savedServerId: string,
    projectionStore: V2ProjectionStore,
    operationStore: V2OperationStore,
  ) {
    super(EMPTY);
    this.#savedServerId = savedServerId;
    this.#projectionStore = projectionStore;
    this.#operationStore = operationStore;
  }

  start(): void {
    if (this.#unsubscribes.length !== 0) return;
    if (this.#session === null) {
      const savedServerId = v2SavedServerId(this.#savedServerId);
      const refresh = () => void this.refresh();
      this.#unsubscribes = [
        this.#projectionStore.subscribe(savedServerId, refresh),
        this.#operationStore.subscribe(savedServerId, refresh),
      ];
    } else {
      this.#unsubscribes = [
        this.#session.subscribe(() => void this.refresh()),
        this.#session.subscribeChange((change) => this.#publishChange(change)),
      ];
      this.#session.start();
    }
    this.refresh().catch(() => undefined);
  }

  attach(session: SyncV2Session): void {
    if (this.#session === session) {
      this.start();
      return;
    }
    this.dispose();
    this.#session = session;
    this.start();
  }

  async refresh(): Promise<void> {
    const sourceGeneration = this.#sourceGeneration;
    const refreshGeneration = ++this.#refreshGeneration;
    const finishRefresh = this.#refreshActivity.begin();
    try {
      const value = await this.#readSnapshot();
      if (
        sourceGeneration === this.#sourceGeneration &&
        refreshGeneration === this.#refreshGeneration
      )
        this.publish({ status: "ready", value });
    } catch {
      if (
        sourceGeneration === this.#sourceGeneration &&
        refreshGeneration === this.#refreshGeneration
      ) {
        this.publish({
          message: "Could not read server projection",
          status: "error",
          value: this.snapshot().value,
        });
      }
    } finally {
      finishRefresh();
    }
  }

  refreshSnapshot = (): ProjectionRefreshState => this.#refreshActivity.snapshot();

  subscribeRefresh = this.#refreshActivity.subscribe;

  subscribeChange(listener: (change: V2ProjectionChange) => void): () => void {
    this.#changeListeners.add(listener);
    return () => this.#changeListeners.delete(listener);
  }

  requestedThreadAuthority(): RequestedThreadAuthority {
    return this.#requestedThread;
  }

  beginRequestedThread(threadId: string): void {
    this.#setRequestedThread({ message: null, status: "loading", threadId });
  }

  confirmRequestedThread(threadId: string): void {
    if (this.#requestedThread.threadId !== threadId) return;
    this.#setRequestedThread({ message: null, status: "ready", threadId });
  }

  failRequestedThread(threadId: string, message: string): void {
    if (this.#requestedThread.threadId !== threadId) return;
    this.#setRequestedThread({ message, status: "error", threadId });
  }

  stop(): void {
    this.dispose();
    this.#session?.stop();
  }

  dispose(): void {
    this.#sourceGeneration += 1;
    this.#refreshActivity.reset();
    for (const unsubscribe of this.#unsubscribes) unsubscribe();
    this.#unsubscribes = [];
  }

  async #readSnapshot(): Promise<SyncV2SessionSnapshot> {
    if (this.#session !== null) {
      const snapshot = await this.#session.snapshot();
      const threadId = this.#requestedThread.threadId;
      if (
        threadId !== null &&
        snapshot.state === "live" &&
        snapshot.projections.live?.currentThread?.thread.id === threadId
      ) {
        this.#requestedThread = { message: null, status: "ready", threadId };
      }
      return snapshot;
    }
    const savedServerId = v2SavedServerId(this.#savedServerId);
    const [retained, operations] = await Promise.all([
      this.#projectionStore.retained(savedServerId),
      this.#operationStore.list(savedServerId),
    ]);
    return {
      operations,
      projections: { live: null, retained },
      state: "offline",
      version: 0,
    };
  }

  #publishChange(change: V2ProjectionChange): void {
    for (const listener of this.#changeListeners) {
      try {
        listener(change);
      } catch {
        // One application invalidation observer cannot suppress its peers.
      }
    }
  }

  #setRequestedThread(next: RequestedThreadAuthority): void {
    if (
      this.#requestedThread.threadId === next.threadId &&
      this.#requestedThread.status === next.status &&
      this.#requestedThread.message === next.message
    )
      return;
    this.#requestedThread = next;
    // WHY: the resource snapshot identity is the React external-store notification boundary;
    // the authoritative projection value itself remains unchanged.
    this.publish({ ...this.snapshot() });
  }
}
