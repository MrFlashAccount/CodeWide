import {
  SyncV2Session,
  v2SavedServerId,
  type SyncV2Connection,
  type V2OperationStore,
  type V2ProjectionStore,
  type V2SavedServerDeletionStore,
  type V2SocketLike,
} from "@codewide/sync-client";

import { mintNativeSession, nativeCompanionHttpOrigin, type NativeConnectionConfig } from "./native-transport.native";
import { createNativeSyncV2OperationStore } from "./sync-v2-operation-store.native";
import { createNativeSyncV2ProjectionStore } from "./sync-v2-projection-store.native";
import { createNativeSyncV2SavedServerDeletionStore } from "./sync-v2-deletion-store.native";

type SessionHandle = Pick<SyncV2Session, "start" | "stop">;

export type NativeSyncV2Lifecycle = {
  reconcile(configs: readonly NativeConnectionConfig[]): Promise<void>;
  deleteSavedServer(savedServerId: string, finalizeSavedServerDelete?: () => Promise<void>): Promise<void>;
  stop(): void;
};

export type NativeSyncV2LifecycleOptions = {
  enabled: boolean;
  projectionStore?: V2ProjectionStore;
  operationStore?: V2OperationStore;
  deletionStore?: V2SavedServerDeletionStore;
  sessionFactory?: (config: NativeConnectionConfig, projectionStore: V2ProjectionStore, operationStore: V2OperationStore) => SessionHandle;
};

/** Owns canary V2 sessions without coupling durable partitions to active selection or credentials. */
export function createNativeSyncV2Lifecycle(options: NativeSyncV2LifecycleOptions): NativeSyncV2Lifecycle {
  const projectionStore = options.projectionStore ?? createNativeSyncV2ProjectionStore();
  const operationStore = options.operationStore ?? createNativeSyncV2OperationStore();
  const deletionStore = options.deletionStore ?? createNativeSyncV2SavedServerDeletionStore();
  const sessionFactory = options.sessionFactory ?? createProductionSession;
  const sessions = new Map<string, { signature: string; session: SessionHandle }>();
  let chain = Promise.resolve();

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = chain.then(operation);
    chain = result.then(() => undefined, () => undefined);
    return result;
  };

  return {
    reconcile(configs) {
      return enqueue(async () => {
        const desired = new Map(configs.map((config) => [config.savedServerId, config]));
        const blocked = new Set(await deletionStore.listPending());
        for (const [savedServerId, running] of sessions) {
          const config = desired.get(savedServerId);
          if (!options.enabled || blocked.has(asSavedServerId(savedServerId)) || config === undefined || !eligible(config) || signature(config) !== running.signature) {
            running.session.stop();
            sessions.delete(savedServerId);
          }
        }
        if (!options.enabled) return;
        for (const config of desired.values()) {
          if (blocked.has(asSavedServerId(config.savedServerId)) || !eligible(config) || sessions.has(config.savedServerId)) continue;
          const session = sessionFactory(config, projectionStore, operationStore);
          sessions.set(config.savedServerId, { signature: signature(config), session });
          session.start();
        }
      });
    },
    deleteSavedServer(savedServerId, finalizeSavedServerDelete) {
      return enqueue(async () => {
        const id = asSavedServerId(savedServerId);
        await deletionStore.begin(id);
        sessions.get(savedServerId)?.session.stop();
        sessions.delete(savedServerId);
        await Promise.allSettled([
          projectionStore.deleteSavedServer(id),
          operationStore.deleteSavedServer(id),
        ]);
        const [projectionPresent, operationPresent] = await Promise.all([
          projectionStore.hasSavedServerData(id),
          operationStore.hasSavedServerData(id),
        ]);
        if (projectionPresent || operationPresent) {
          throw new Error("Sync V2 saved-server deletion remains blocked until every durable namespace is unreadable");
        }
        await finalizeSavedServerDelete?.();
        await deletionStore.complete(id);
      });
    },
    stop() {
      for (const running of sessions.values()) running.session.stop();
      sessions.clear();
    },
  };
}

function createProductionSession(
  config: NativeConnectionConfig,
  projectionStore: V2ProjectionStore,
  operationStore: V2OperationStore,
): SyncV2Session {
  const connection: SyncV2Connection = {
    savedServerId: config.savedServerId,
    endpoint: v2Endpoint(config.endpoint),
    tlsPinSha256: config.tlsPinSha256!,
    deviceId: config.deviceId!,
  };
  return new SyncV2Session({
    connection,
    intent: { catalog: { activeLimit: 100, archivedLimit: 100 }, currentThread: null },
    projectionStore,
    operationStore,
    socketFactory: () => new NativePinnedV2Socket(config),
  });
}

class NativePinnedV2Socket implements V2SocketLike {
  readyState = 0;
  readonly #listeners = {
    open: [] as Array<() => void>,
    message: [] as Array<(event: { data: unknown }) => void>,
    close: [] as Array<() => void>,
    error: [] as Array<() => void>,
  };
  #socket: WebSocket | null = null;
  #closed = false;

  constructor(config: NativeConnectionConfig) {
    void this.#connect(config);
  }

  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "close", listener: () => void): void;
  addEventListener(type: "error", listener: () => void): void;
  addEventListener(type: "open" | "message" | "close" | "error", listener: (() => void) | ((event: { data: unknown }) => void)): void {
    (this.#listeners[type] as Array<typeof listener>).push(listener);
  }

  send(data: string): void {
    if (this.#socket === null || this.readyState !== 1) throw new Error("Native Sync V2 socket is not open");
    this.#socket.send(data);
  }

  close(code?: number, reason?: string): void {
    if (this.#closed) return;
    this.#closed = true;
    this.readyState = 2;
    if (this.#socket !== null) this.#socket.close(code, reason);
    else this.#emitClose();
  }

  async #connect(config: NativeConnectionConfig): Promise<void> {
    try {
      const [origin, session] = await Promise.all([
        nativeCompanionHttpOrigin(config.connectionId, config.endpoint),
        mintNativeSession(config.connectionId),
      ]);
      if (this.#closed) return;
      const url = `${origin.replace(/^http:/u, "ws:")}/v2/sync`;
      const Socket = WebSocket as unknown as new (
        url: string,
        protocols: string[],
        options: { headers: Record<string, string> },
      ) => WebSocket;
      const socket = new Socket(url, [], { headers: { Authorization: `Bearer ${session.sessionToken}` } });
      this.#socket = socket;
      socket.addEventListener("open", () => {
        if (this.#closed) return socket.close(1000, "client_stopped");
        this.readyState = 1;
        for (const listener of this.#listeners.open) listener();
      });
      socket.addEventListener("message", (event) => {
        for (const listener of this.#listeners.message) listener({ data: event.data });
      });
      socket.addEventListener("error", () => {
        for (const listener of this.#listeners.error) listener();
      });
      socket.addEventListener("close", () => this.#emitClose());
    } catch {
      if (this.#closed) return;
      for (const listener of this.#listeners.error) listener();
      this.#emitClose();
    }
  }

  #emitClose(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    for (const listener of this.#listeners.close) listener();
  }
}

function eligible(config: NativeConnectionConfig): boolean {
  return config.enabled
    && config.savedServerId === config.connectionId
    && /^sha256\/[A-Za-z0-9+/]{43}=$/u.test(config.tlsPinSha256 ?? "")
    && /^device-[a-f0-9]{64}$/u.test(config.deviceId ?? "");
}

function signature(config: NativeConnectionConfig): string {
  return `${config.endpoint}\u0000${config.tlsPinSha256}\u0000${config.deviceId}`;
}

function v2Endpoint(endpoint: string): string {
  const url = new URL(endpoint);
  url.pathname = "/v2/sync";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function asSavedServerId(value: string): import("@codewide/sync-client").V2SavedServerId {
  return v2SavedServerId(value);
}
