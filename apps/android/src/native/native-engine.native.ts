import {
  RpcResponseError,
  type RemoteConnection,
  type RemoteConnectionState,
  type RpcClient,
  type SyncEvent,
  type SyncServerRequest,
  type SyncSnapshotThread,
} from "@codewide/sync-client";
import { NativeEventEmitter, NativeModules } from "react-native";
import { shouldFlushLiveEventsImmediately } from "../data/live-event-priority";
import { parseNativeCommandDelivery, type NativeCommandDelivery } from "./native-transport.native";
import { OrderedProjectionGate, type ProjectionWork } from "./ordered-projection-gate";

type NativeEngineEvent = {
  contractVersion: 1;
  connectionId: string;
  type: "state" | "snapshot" | "pendingRequests" | "events" | "checkpointEvents" | "outbox";
  data: string;
  frameId?: number;
  projectionCursor?: number;
};

type NativeEngineState = {
  state: RemoteConnectionState;
  rpcAvailable?: boolean;
  error?: string;
};

type NativeEngineResult<T> =
  | { ok: true; result: T }
  | { ok: false; message: string; code?: number };

type NativeDomainProjection = {
  applySnapshot(connectionId: string, threads: SyncSnapshotThread[], cursor: number): Promise<void>;
  applyEvents(connectionId: string, events: SyncEvent[]): Promise<void>;
};
type NativeConnectionStateProjection = {
  setConnectionState(connectionId: string, state: RemoteConnectionState, diagnostic?: string | null): void | Promise<void>;
};

type NativeBridge = {
  attachSocket(connectionId: string): Promise<void>;
  engineRpc(connectionId: string, method: string, paramsJson: string): Promise<string>;
  wakeSocket(connectionId: string): void;
  acknowledgeProjection(connectionId: string, projectionCursor: number): void;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
};

const bridge = NativeModules.CodeWideNative as NativeBridge | undefined;
const MAX_COALESCED_LIVE_EVENTS = 1_024;

type EventProjectionWork = ProjectionWork & {
  readonly eventProjection: {
    events: SyncEvent[];
    projectionCursor: number;
    flushBoundary: boolean;
  };
};

export class NativeEngineSession implements RpcClient {
  readonly connectionId: string;
  readonly #connectionState: NativeConnectionStateProjection;
  readonly #projection: NativeDomainProjection;
  readonly #onPendingRequests: ((connectionId: string, requests: SyncServerRequest[]) => void) | undefined;
  readonly #projectionGate: OrderedProjectionGate;
  #stopped = false;
  #stateGeneration = 0;
  #projectionRecoveryTimer: ReturnType<typeof setTimeout> | undefined;
  #projectionRecoveryAttempt = 0;

  constructor(options: {
    connection: RemoteConnection;
    connectionState: NativeConnectionStateProjection;
    projection: NativeDomainProjection;
    onPendingRequests?: (connectionId: string, requests: SyncServerRequest[]) => void;
  }) {
    this.connectionId = options.connection.id;
    this.#connectionState = options.connectionState;
    this.#projection = options.projection;
    this.#onPendingRequests = options.onPendingRequests;
    this.#projectionGate = new OrderedProjectionGate((cause) => {
      this.#stateGeneration += 1;
      void this.#connectionState.setConnectionState(this.connectionId, "degraded", errorMessage(cause, "Native projection update failed"));
      this.#scheduleProjectionRecovery();
    });
  }

  start(): void {
    if (bridge === undefined) {
      void this.#connectionState.setConnectionState(this.connectionId, "degraded", "Native remote engine is unavailable in this build");
      return;
    }
    void bridge.attachSocket(this.connectionId).catch((cause: unknown) => {
      void this.#connectionState.setConnectionState(this.connectionId, "degraded", errorMessage(cause, "Could not start native remote engine"));
    });
  }

  stop(): void {
    this.#stopped = true;
    if (this.#projectionRecoveryTimer !== undefined) clearTimeout(this.#projectionRecoveryTimer);
    this.#projectionRecoveryTimer = undefined;
  }

  receive(event: NativeEngineEvent): void {
    if (this.#stopped) return;
    if (event.contractVersion !== 1) {
      void this.#connectionState.setConnectionState(this.connectionId, "degraded", "Native bridge contract version is unsupported");
      return;
    }
    if (event.type === "state") {
      try {
        const state = parseJson<NativeEngineState>(event.data, "native engine state");
        const generation = ++this.#stateGeneration;
        if (state.state === "live") {
          // The transport can announce caught-up after it emitted the final
          // projection batch, while that batch is still committing to SQLite.
          // Keep the UI in syncing until the ordered durable projection seam
          // has drained; RPC availability remains a separate transport axis.
          void Promise.resolve(this.#connectionState.setConnectionState(this.connectionId, "syncing"));
          void this.#projectionGate.settled().then(() => {
            if (this.#stopped || generation !== this.#stateGeneration || this.#projectionGate.blocked) return;
            return this.#connectionState.setConnectionState(this.connectionId, "live", null);
          });
        } else {
          void Promise.resolve(this.#connectionState.setConnectionState(
            this.connectionId,
            state.state,
            state.error,
          ));
        }
      } catch (cause: unknown) {
        void this.#connectionState.setConnectionState(this.connectionId, "degraded", errorMessage(cause, "Native engine state is invalid"));
      }
      return;
    }
    if (event.type === "pendingRequests") {
      try {
        const requests = parseJson<SyncServerRequest[]>(event.data, "pending server requests");
        if (!Array.isArray(requests)) throw new Error("Native pending request projection is invalid");
        this.#onPendingRequests?.(this.connectionId, requests);
      } catch (cause: unknown) {
        void this.#connectionState.setConnectionState(this.connectionId, "degraded", errorMessage(cause, "Native pending request projection is invalid"));
      }
      return;
    }
    if (event.type === "outbox") {
      // Outbox events are handled as compact deltas by the supervisor. They
      // must never be misparsed as protocol frames or trigger a table scan.
      return;
    }
    try {
      const projectionCursor = event.projectionCursor;
      if (typeof projectionCursor !== "number" || !Number.isSafeInteger(projectionCursor)) {
        throw new Error("Native projection cursor is missing or invalid");
      }
      if (event.type === "snapshot") {
        const snapshot = parseJson<{ cursor: number; threads: SyncSnapshotThread[] }>(event.data, "native snapshot");
        if (!Number.isSafeInteger(snapshot.cursor) || !Array.isArray(snapshot.threads)) throw new Error("Native snapshot is invalid");
        if (projectionCursor !== snapshot.cursor) throw new Error("Native snapshot projection cursor is invalid");
        this.#projectionGate.enqueue({
          recovery: true,
          apply: async () => {
            if (this.#stopped) return;
            await this.#projection.applySnapshot(this.connectionId, snapshot.threads, snapshot.cursor);
            this.#projectionRecovered();
          },
          acknowledge: () => {
            if (!this.#stopped) bridge?.acknowledgeProjection(this.connectionId, snapshot.cursor);
          },
        });
        return;
      }
      const frames = parseJson<Array<{ frameId: number; frame: { type: string; cursor: number; payload: Record<string, unknown> } }>>(event.data, "native event batch");
      if (!Array.isArray(frames) || frames.length === 0) throw new Error("Native event projection is invalid");
      const syncEvents = frames.map(({ frame }) => {
        if (frame.type !== "event" || !Number.isSafeInteger(frame.cursor) || frame.payload === null || typeof frame.payload !== "object") {
          throw new Error("Native event projection is invalid");
        }
        return { cursor: frame.cursor, payload: frame.payload } satisfies SyncEvent;
      });
      if (projectionCursor !== syncEvents.at(-1)?.cursor) throw new Error("Native event projection cursor is invalid");
      this.#projectionGate.enqueue(this.#eventProjectionWork(syncEvents, projectionCursor, event.type === "checkpointEvents"));
    } catch (cause: unknown) {
      this.#projectionGate.enqueue({
        recovery: event.type === "checkpointEvents",
        apply: async () => { throw cause; },
        acknowledge: () => undefined,
      });
    }
  }

  #eventProjectionWork(events: SyncEvent[], projectionCursor: number, recovery: boolean): EventProjectionWork {
    const eventProjection = {
      events: [...events],
      projectionCursor,
      flushBoundary: shouldFlushLiveEventsImmediately(events),
    };
    const work: EventProjectionWork = {
      recovery,
      eventProjection,
      apply: async () => {
        if (this.#stopped) return;
        await this.#projection.applyEvents(this.connectionId, eventProjection.events);
        if (recovery) this.#projectionRecovered();
      },
      acknowledge: () => {
        if (!this.#stopped) bridge?.acknowledgeProjection(this.connectionId, eventProjection.projectionCursor);
      },
      mergeWith: (newer) => {
        if (recovery || eventProjection.flushBoundary || !isEventProjectionWork(newer) || newer.recovery) return null;
        if (eventProjection.events.length + newer.eventProjection.events.length > MAX_COALESCED_LIVE_EVENTS) return null;
        eventProjection.events.push(...newer.eventProjection.events);
        eventProjection.projectionCursor = newer.eventProjection.projectionCursor;
        eventProjection.flushBoundary = newer.eventProjection.flushBoundary;
        return work;
      },
    };
    return work;
  }

  async rpc<T>(method: string, params: unknown): Promise<T> {
    if (bridge === undefined) throw new Error("Native remote engine is unavailable");
    const envelope = parseJson<NativeEngineResult<T>>(
      await bridge.engineRpc(this.connectionId, method, JSON.stringify(params ?? null)),
      "native RPC response",
    );
    if (envelope.ok) return envelope.result;
    if (typeof envelope.code === "number") throw new RpcResponseError(envelope.code, envelope.message);
    throw new Error(envelope.message);
  }

  #scheduleProjectionRecovery(): void {
    if (this.#stopped || bridge === undefined || this.#projectionRecoveryTimer !== undefined) return;
    const delay = Math.min(30_000, 500 * 2 ** Math.min(this.#projectionRecoveryAttempt++, 6));
    this.#projectionRecoveryTimer = setTimeout(() => {
      this.#projectionRecoveryTimer = undefined;
      if (this.#stopped) return;
      void bridge.attachSocket(this.connectionId).catch((cause: unknown) => {
        void this.#connectionState.setConnectionState(this.connectionId, "degraded", errorMessage(cause, "Native projection recovery failed"));
        this.#scheduleProjectionRecovery();
      });
    }, delay);
  }

  #projectionRecovered(): void {
    this.#projectionRecoveryAttempt = 0;
    if (this.#projectionRecoveryTimer !== undefined) clearTimeout(this.#projectionRecoveryTimer);
    this.#projectionRecoveryTimer = undefined;
  }
}

export class NativeEngineSupervisor {
  readonly #connectionState: NativeConnectionStateProjection;
  readonly #projection: NativeDomainProjection;
  readonly #onPendingRequests: ((connectionId: string, requests: SyncServerRequest[]) => void) | undefined;
  readonly #onOutboxChange: ((delivery: NativeCommandDelivery) => void) | undefined;
  readonly #sessions = new Map<string, NativeEngineSession>();
  readonly #fingerprints = new Map<string, string>();
  readonly #subscription: { remove(): void } | null;

  constructor(options: {
    connectionState: NativeConnectionStateProjection;
    projection: NativeDomainProjection;
    onPendingRequests?(connectionId: string, requests: SyncServerRequest[]): void;
    onOutboxChange?(delivery: NativeCommandDelivery): void;
  }) {
    this.#connectionState = options.connectionState;
    this.#projection = options.projection;
    this.#onPendingRequests = options.onPendingRequests;
    this.#onOutboxChange = options.onOutboxChange;
    this.#subscription = bridge === undefined
      ? null
      : new NativeEventEmitter(NativeModules.CodeWideNative).addListener("CodeWideEngineEvent", (event: NativeEngineEvent) => {
        if (event.contractVersion === 1 && event.type === "outbox") {
          try {
            this.#onOutboxChange?.(parseNativeCommandDelivery(JSON.parse(event.data)));
          } catch {
            // Malformed native projections are never repaired with an
            // unbounded cross-server rescan.
          }
        }
        this.#sessions.get(event.connectionId)?.receive(event);
      });
  }

  replaceConnections(connections: RemoteConnection[]): void {
    const enabled = connections.filter((connection) => connection.enabled);
    const wanted = new Map(enabled.map((connection) => [connection.id, fingerprint(connection)]));
    for (const [id, session] of this.#sessions) {
      if (wanted.get(id) === this.#fingerprints.get(id)) continue;
      session.stop();
      this.#sessions.delete(id);
      this.#fingerprints.delete(id);
    }
    for (const connection of enabled) {
      if (this.#sessions.has(connection.id)) continue;
      const session = new NativeEngineSession({
        connection,
        connectionState: this.#connectionState,
        projection: this.#projection,
        ...(this.#onPendingRequests === undefined ? {} : { onPendingRequests: this.#onPendingRequests }),
      });
      this.#sessions.set(connection.id, session);
      this.#fingerprints.set(connection.id, fingerprint(connection));
      session.start();
    }
  }

  session(connectionId: string): NativeEngineSession | undefined {
    return this.#sessions.get(connectionId);
  }

  stop(): void {
    for (const session of this.#sessions.values()) session.stop();
    this.#sessions.clear();
    this.#fingerprints.clear();
    this.#subscription?.remove();
  }
}

function fingerprint(connection: RemoteConnection): string {
  return JSON.stringify([connection.endpoint, connection.tlsPinSha256 ?? null]);
}

function parseJson<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Invalid ${label}`);
  }
}

function isEventProjectionWork(work: ProjectionWork): work is EventProjectionWork {
  return "eventProjection" in work;
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.length > 0 ? cause.message : fallback;
}
