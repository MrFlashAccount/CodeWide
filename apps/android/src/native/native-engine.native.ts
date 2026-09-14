import type { NativeDomainProjection, NativeConnectionStateProjection, NativeEngineSupervisorOptions } from "./native-engine-contract";
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
import { incrementDiagnosticMetric, liveStreamMetricKey, markLiveBatchDelivered, operationalDiagnosticsEnabled, recordDiagnosticTiming } from "../data/operational-metrics";
import {
  recordOperationalTelemetryEvent,
  recordTelemetryEvent,
  type TelemetryEventInput,
} from "../data/telemetry";

import { OrderedProjectionAcknowledger } from "./ordered-projection-acknowledger";
import { nativeEngineErrorDiagnostic } from "./native-engine-error-diagnostic";
import { parseNativeCommandDelivery, type NativeCommandDelivery } from "./native-transport.native";
import { OrderedProjectionGate, type ProjectionWork } from "./ordered-projection-gate";

type NativeEngineEvent = {
  contractVersion: 1 | 2;
  connectionId: string;
  type: "state" | "snapshot" | "pendingRequests" | "events" | "checkpointEvents" | "journalAdvanced" | "outbox" | "telemetry";
  data: string;
  frameId?: number;
  projectionCursor?: number;
};

type NativeEngineState = {
  state: RemoteConnectionState;
  rpcAvailable: boolean;
  error?: string;
};

type NativeEngineResult<T> =
  | { ok: true; result: T }
  | { ok: false; message: string; code?: number };

type NativeBridge = {
  attachSocket(connectionId: string): Promise<void>;
  engineRpc(connectionId: string, method: string, paramsJson: string): Promise<string>;
  wakeSocket(connectionId: string): void;
  acknowledgeProjection(connectionId: string, projectionCursor: number): void;
  readCommittedFrames(connectionId: string, afterCursor: number | null): Promise<NativeCommittedFramePage>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
};

type NativeCommittedFramePage = {
  baseCursor?: number;
  headCursor?: number;
  frames: Array<{ cursor: number; payload: string }>;
};

const bridge = NativeModules.CodeWideNative as NativeBridge | undefined;
const MAX_COALESCED_LIVE_EVENTS = 1_024;

type EventProjectionWork = ProjectionWork & {
  readonly eventProjection: {
    events: SyncEvent[];
    projectionCursor: number;
    flushBoundary: boolean;
    checkpoint: Promise<void>;
  };
};

export class NativeEngineSession implements RpcClient {
  readonly connectionId: string;
  readonly #connectionState: NativeConnectionStateProjection;
  readonly #projection: NativeDomainProjection;
  readonly #onPendingRequests: ((connectionId: string, requests: SyncServerRequest[]) => void) | undefined;
  readonly #projectionGate: OrderedProjectionGate;
  readonly #projectionAcknowledger: OrderedProjectionAcknowledger;
  #stopped = false;
  #stateGeneration = 0;
  #publishedLiveRpcAvailable: boolean | undefined;
  #projectionRecoveryTimer: ReturnType<typeof setTimeout> | undefined;
  #projectionRecoveryAttempt = 0;
  #journalReadCursor: number | undefined;
  #journalHeadCursor: number | undefined;
  #journalRecoveryRequested = false;
  #journalDrain: Promise<void> | undefined;

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
    const projectionFailed = (cause: unknown) => {
      this.#publishedLiveRpcAvailable = undefined;
      this.#stateGeneration += 1;
      this.#journalReadCursor = undefined;
      void this.#connectionState.setConnectionState(this.connectionId, "degraded", nativeEngineErrorDiagnostic(cause, "Native projection update failed"));
      this.#scheduleProjectionRecovery();
    };
    this.#projectionGate = new OrderedProjectionGate(projectionFailed);
    this.#projectionAcknowledger = new OrderedProjectionAcknowledger(projectionFailed);
  }

  start(): void {
    this.#publishedLiveRpcAvailable = undefined;
    if (bridge === undefined) {
      void this.#connectionState.setConnectionState(this.connectionId, "degraded", "Native remote engine is unavailable in this build", false);
      return;
    }
    void this.#connectionState.setConnectionState(this.connectionId, "connecting", null, false);
    void bridge.attachSocket(this.connectionId).catch((cause: unknown) => {
      void this.#connectionState.setConnectionState(this.connectionId, "degraded", nativeEngineErrorDiagnostic(cause, "Could not start native remote engine"), false);
    });
  }

  async reattachRuntime(): Promise<void> {
    if (this.#stopped || bridge === undefined) return;
    await bridge.attachSocket(this.connectionId);
  }

  stop(): void {
    this.#stopped = true;
    if (this.#projectionRecoveryTimer !== undefined) clearTimeout(this.#projectionRecoveryTimer);
    this.#projectionRecoveryTimer = undefined;
    this.#journalHeadCursor = undefined;
    this.#journalReadCursor = undefined;
  }

  receive(event: NativeEngineEvent): void {
    if (this.#stopped) return;
    if (event.contractVersion !== 1 && event.contractVersion !== 2) {
      this.#publishedLiveRpcAvailable = undefined;
      void this.#connectionState.setConnectionState(this.connectionId, "degraded", "Native bridge contract version is unsupported", false);
      return;
    }
    if (event.type === "telemetry") {
      const telemetry = parseNativeTelemetry(event.data);
      if (telemetry !== null) recordOperationalTelemetryEvent(this.connectionId, telemetry);
      return;
    }
    if (event.type === "state") {
      try {
        const state = parseJson<NativeEngineState>(event.data, "native engine state");
        if (typeof state.rpcAvailable !== "boolean") throw new Error("Native engine state omitted RPC availability");
        const generation = ++this.#stateGeneration;
        if (state.state === "live") {
          // The transport can announce caught-up after it emitted the final
          // projection batch, while that batch is still committing to SQLite.
          // Keep the UI in syncing until the ordered durable projection seam
          // has drained; RPC availability remains a separate transport axis.
          // Reattaching an existing JS runtime also emits its unchanged native
          // state. Do not fabricate a reconnect: that edge reloads the chat.
          if (this.#publishedLiveRpcAvailable !== state.rpcAvailable) {
            void Promise.resolve(this.#connectionState.setConnectionState(this.connectionId, "syncing", undefined, state.rpcAvailable));
          }
          void Promise.resolve(this.#journalDrain).then(() => this.#projectionGate.settled()).then(async () => {
            // The gate enqueues acknowledgement only after applying the batch,
            // so observe its tail after the presentation queue has drained.
            await this.#projectionAcknowledger.settled();
          }).then(() => {
            if (
              this.#stopped
              || generation !== this.#stateGeneration
              || this.#projectionGate.blocked
              || this.#projectionAcknowledger.blocked
            ) return;
            if (this.#publishedLiveRpcAvailable === state.rpcAvailable) return;
            this.#publishedLiveRpcAvailable = state.rpcAvailable;
            return this.#connectionState.setConnectionState(this.connectionId, "live", null, state.rpcAvailable);
          });
        } else {
          this.#publishedLiveRpcAvailable = undefined;
          void Promise.resolve(this.#connectionState.setConnectionState(
            this.connectionId,
            state.state,
            state.error,
            state.rpcAvailable,
          ));
        }
      } catch (cause: unknown) {
        this.#publishedLiveRpcAvailable = undefined;
        void this.#connectionState.setConnectionState(this.connectionId, "degraded", nativeEngineErrorDiagnostic(cause, "Native engine state is invalid"), false);
      }
      return;
    }
    if (event.type === "pendingRequests") {
      try {
        const requests = parseJson<SyncServerRequest[]>(event.data, "pending server requests");
        if (!Array.isArray(requests)) throw new Error("Native pending request projection is invalid");
        this.#onPendingRequests?.(this.connectionId, requests);
      } catch (cause: unknown) {
        this.#publishedLiveRpcAvailable = undefined;
        void this.#connectionState.setConnectionState(this.connectionId, "degraded", nativeEngineErrorDiagnostic(cause, "Native pending request projection is invalid"));
      }
      return;
    }
    if (event.type === "outbox") {
      // Outbox events are handled as compact deltas by the supervisor. They
      // must never be misparsed as protocol frames or trigger a table scan.
      return;
    }
    if (event.type === "journalAdvanced") {
      try {
        const projectionCursor = event.projectionCursor;
        if (typeof projectionCursor !== "number" || !Number.isSafeInteger(projectionCursor)) {
          throw new Error("Native journal cursor is missing or invalid");
        }
        const signal = parseJson<{
          recovery?: boolean;
          eventCount?: number;
          bytes?: number;
          commitMs?: number;
          journalFrameCount?: number;
          journalPayloadBytes?: number;
          mainFileBytes?: number;
          walFileBytes?: number;
          shmFileBytes?: number;
        }>(event.data, "native journal signal");
        if (operationalDiagnosticsEnabled() && signal.recovery !== true) {
          if (typeof signal.commitMs === "number") recordDiagnosticTiming("native_journal_commit_ms", signal.commitMs);
          incrementDiagnosticMetric("native_journal_commits");
          if (Number.isSafeInteger(signal.eventCount) && signal.eventCount! > 0) {
            incrementDiagnosticMetric("native_journal_committed_events", signal.eventCount);
          }
        }
        if (signal.recovery !== true && typeof signal.commitMs === "number") {
          recordTelemetryEvent(this.connectionId, {
            name: "stream.native_journal_commit",
            values: {
              commitMs: signal.commitMs,
              eventCount: Number.isSafeInteger(signal.eventCount) ? signal.eventCount! : 0,
              bytes: Number.isSafeInteger(signal.bytes) ? signal.bytes! : 0,
              journalFrameCount: Number.isSafeInteger(signal.journalFrameCount) ? signal.journalFrameCount! : 0,
              journalPayloadBytes: Number.isSafeInteger(signal.journalPayloadBytes) ? signal.journalPayloadBytes! : 0,
              mainFileBytes: Number.isSafeInteger(signal.mainFileBytes) ? signal.mainFileBytes! : 0,
              walFileBytes: Number.isSafeInteger(signal.walFileBytes) ? signal.walFileBytes! : 0,
              shmFileBytes: Number.isSafeInteger(signal.shmFileBytes) ? signal.shmFileBytes! : 0,
            },
          });
        }
        this.#requestJournalDrain(projectionCursor, signal.recovery === true);
      } catch (cause: unknown) {
        this.#enqueueProjectionFailure(cause, true);
      }
      return;
    }
    try {
      const projectionCursor = event.projectionCursor;
      if (typeof projectionCursor !== "number" || !Number.isSafeInteger(projectionCursor)) {
        throw new Error("Native projection cursor is missing or invalid");
      }
      if (event.type === "snapshot") {
        this.#publishedLiveRpcAvailable = undefined;
        const snapshot = parseJson<{ cursor: number; threads: SyncSnapshotThread[] }>(event.data, "native snapshot");
        if (!Number.isSafeInteger(snapshot.cursor) || !Array.isArray(snapshot.threads)) throw new Error("Native snapshot is invalid");
        if (projectionCursor !== snapshot.cursor) throw new Error("Native snapshot projection cursor is invalid");
        this.#journalReadCursor = snapshot.cursor;
        this.#projectionGate.enqueue({
          recovery: true,
          apply: async () => {
            if (this.#stopped) return;
            await this.#projection.applySnapshot(this.connectionId, snapshot.threads, snapshot.cursor);
            this.#projectionRecovered();
          },
          acknowledge: () => {
            this.#projectionAcknowledger.enqueue({
              recovery: true,
              checkpoint: Promise.resolve(),
              acknowledge: () => {
                if (!this.#stopped) bridge?.acknowledgeProjection(this.connectionId, snapshot.cursor);
              },
            });
          },
        });
        return;
      }
      const measureDiagnostics = operationalDiagnosticsEnabled();
      const decodeStartedAt = measureDiagnostics ? performance.now() : 0;
      const frames = parseJson<Array<{ frameId: number; frame: { type: string; cursor: number; payload: Record<string, unknown> } }>>(event.data, "native event batch");
      if (measureDiagnostics) recordDiagnosticTiming("native_json_decode_ms", performance.now() - decodeStartedAt);
      if (!Array.isArray(frames) || frames.length === 0) throw new Error("Native event projection is invalid");
      const syncEvents = frames.map(({ frame }) => {
        if (frame.type !== "event" || !Number.isSafeInteger(frame.cursor) || frame.payload === null || typeof frame.payload !== "object") {
          throw new Error("Native event projection is invalid");
        }
        return { cursor: frame.cursor, payload: frame.payload } satisfies SyncEvent;
      });
      if (projectionCursor !== syncEvents.at(-1)?.cursor) throw new Error("Native event projection cursor is invalid");
      const recovery = event.type === "checkpointEvents";
      this.#enqueueSyncEvents(syncEvents, projectionCursor, recovery, event.data.length);
    } catch (cause: unknown) {
      this.#enqueueProjectionFailure(cause, event.type === "checkpointEvents");
    }
  }

  #requestJournalDrain(headCursor: number, recovery: boolean): void {
    // The same runtime already owns everything through this cursor, including
    // any queued writes. A failed write clears the cursor in projectionFailed.
    if (this.#journalReadCursor !== undefined && headCursor <= this.#journalReadCursor) return;
    if (recovery) this.#publishedLiveRpcAvailable = undefined;
    this.#journalHeadCursor = Math.max(this.#journalHeadCursor ?? headCursor, headCursor);
    this.#journalRecoveryRequested ||= recovery;
    if (this.#journalDrain !== undefined || bridge === undefined) return;
    const drain = this.#drainCommittedJournal();
    this.#journalDrain = drain;
    void drain.catch((cause: unknown) => {
      this.#journalHeadCursor = undefined;
      this.#journalReadCursor = undefined;
      this.#enqueueProjectionFailure(cause, true);
    }).finally(() => {
      if (this.#journalDrain === drain) this.#journalDrain = undefined;
      const head = this.#journalHeadCursor;
      if (!this.#stopped && head !== undefined && (this.#journalReadCursor ?? -1) < head) {
        this.#requestJournalDrain(head, this.#journalRecoveryRequested);
      }
    });
  }

  async #drainCommittedJournal(): Promise<void> {
    if (bridge === undefined) return;
    while (!this.#stopped) {
      const requestedHead = this.#journalHeadCursor;
      if (requestedHead === undefined) return;
      const page = await bridge.readCommittedFrames(this.connectionId, this.#journalReadCursor ?? null);
      if (!Array.isArray(page.frames)) throw new Error("Native committed frame page is invalid");
      if (page.baseCursor !== undefined && !Number.isSafeInteger(page.baseCursor)) {
        throw new Error("Native journal base cursor is invalid");
      }
      if (page.headCursor !== undefined && !Number.isSafeInteger(page.headCursor)) {
        throw new Error("Native journal head cursor is invalid");
      }
      if (this.#journalReadCursor === undefined && page.baseCursor !== undefined) {
        this.#journalReadCursor = page.baseCursor;
      }
      if (page.headCursor !== undefined) {
        this.#journalHeadCursor = Math.max(this.#journalHeadCursor ?? page.headCursor, page.headCursor);
      }
      if (page.frames.length === 0) {
        if ((this.#journalReadCursor ?? -1) >= requestedHead) {
          if (this.#journalHeadCursor === requestedHead) this.#journalHeadCursor = undefined;
          return;
        }
        throw new Error("Native journal signalled committed frames but returned an empty page");
      }

      const decodeStartedAt = operationalDiagnosticsEnabled() ? performance.now() : 0;
      let rawBytes = 0;
      let previousCursor = this.#journalReadCursor;
      const syncEvents = page.frames.map((stored) => {
        if (!Number.isSafeInteger(stored.cursor) || typeof stored.payload !== "string") {
          throw new Error("Native committed frame is invalid");
        }
        if (previousCursor !== undefined && stored.cursor !== previousCursor + 1) {
          throw new Error("Native committed frame cursor is not contiguous");
        }
        const envelope = parseJson<{ type?: string; cursor?: number; payload?: Record<string, unknown> }>(stored.payload, "native committed frame");
        rawBytes += stored.payload.length;
        if (
          envelope.type !== "event"
          || envelope.cursor !== stored.cursor
          || envelope.payload === null
          || typeof envelope.payload !== "object"
        ) throw new Error("Native committed frame envelope is invalid");
        previousCursor = stored.cursor;
        return { cursor: stored.cursor, payload: envelope.payload } satisfies SyncEvent;
      });
      if (operationalDiagnosticsEnabled()) {
        recordDiagnosticTiming("native_json_decode_ms", performance.now() - decodeStartedAt);
      }
      const projectionCursor = syncEvents.at(-1)!.cursor;
      this.#journalReadCursor = projectionCursor;
      const recovery = this.#journalRecoveryRequested;
      this.#journalRecoveryRequested = false;
      this.#enqueueSyncEvents(syncEvents, projectionCursor, recovery, rawBytes);
      if (projectionCursor >= requestedHead && this.#journalHeadCursor === requestedHead) {
        this.#journalHeadCursor = undefined;
        return;
      }
    }
  }

  #enqueueSyncEvents(events: SyncEvent[], projectionCursor: number, recovery: boolean, bridgeBytes: number): void {
    const measureDiagnostics = operationalDiagnosticsEnabled();
    if (measureDiagnostics) {
      incrementDiagnosticMetric("native_event_batches");
      incrementDiagnosticMetric("native_event_bytes", bridgeBytes);
      incrementDiagnosticMetric("native_events", events.length);
      if (!recovery && shouldFlushLiveEventsImmediately(events)) incrementDiagnosticMetric("live_immediate_flushes");
    }
    const liveIngress = new Map<string, NonNullable<ReturnType<typeof agentMessageDeltaMetric>>>();
    for (const syncEvent of events) {
      const delta = agentMessageDeltaMetric(this.connectionId, syncEvent);
      if (delta === null) continue;
      const previous = liveIngress.get(delta.streamKey);
      liveIngress.set(delta.streamKey, previous === undefined ? delta : { ...delta, chars: previous.chars + delta.chars });
    }
    for (const delta of liveIngress.values()) {
      recordTelemetryEvent(this.connectionId, {
        name: "stream.native_bridge_batch",
        sessionId: delta.threadId,
        threadId: delta.threadId,
        turnId: delta.turnId,
        itemId: delta.itemId,
        values: { deltaChars: delta.chars, eventCount: events.length, bridgeBytes },
      });
    }
    this.#projectionGate.enqueue(this.#eventProjectionWork(events, projectionCursor, recovery));
  }

  #enqueueProjectionFailure(cause: unknown, recovery: boolean): void {
    this.#projectionGate.enqueue({
      recovery,
      apply: async () => { throw cause; },
      acknowledge: () => undefined,
    });
  }

  #eventProjectionWork(events: SyncEvent[], projectionCursor: number, recovery: boolean): EventProjectionWork {
    const eventProjection = {
      events: [...events],
      projectionCursor,
      flushBoundary: shouldFlushLiveEventsImmediately(events),
      checkpoint: Promise.resolve(),
    };
    const work: EventProjectionWork = {
      recovery,
      eventProjection,
      apply: async () => {
        if (this.#stopped) return;
        const measureDiagnostics = operationalDiagnosticsEnabled();
        const startedAt = performance.now();
        const projected = await this.#projection.applyEvents(this.connectionId, eventProjection.events);
        const projectionMs = performance.now() - startedAt;
        if (projectionMs >= 50) {
          recordOperationalTelemetryEvent(this.connectionId, {
            name: "sync.projection_slow",
            values: { durationMs: projectionMs, eventCount: eventProjection.events.length },
            tags: { mode: recovery ? "recovery" : "live", measurement: "elapsed_including_await" },
          });
        }
        if (measureDiagnostics) {
          recordDiagnosticTiming("projection_apply_ms", projectionMs);
        }
        if (!recovery) {
          const liveDeltas = eventProjection.events.flatMap((event) => {
            const delta = agentMessageDeltaMetric(this.connectionId, event);
            return delta === null ? [] : [delta];
          });
          if (measureDiagnostics) {
            incrementDiagnosticMetric("live_events", liveDeltas.length);
          }
          const charsByStream = new Map<string, number>();
          for (const delta of liveDeltas) charsByStream.set(delta.streamKey, (charsByStream.get(delta.streamKey) ?? 0) + delta.chars);
          for (const [streamKey, chars] of charsByStream) {
            markLiveBatchDelivered(streamKey, chars, { projectionMs, eventCount: eventProjection.events.length });
          }
        }
        eventProjection.checkpoint = projected.checkpoint;
        if (recovery) this.#projectionRecovered();
      },
      acknowledge: () => {
        this.#projectionAcknowledger.enqueue({
          recovery,
          checkpoint: eventProjection.checkpoint,
          acknowledge: () => {
            if (!this.#stopped) bridge?.acknowledgeProjection(this.connectionId, eventProjection.projectionCursor);
          },
        });
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
    if (this.#stopped) throw new Error("Native connection session was replaced");
    if (bridge === undefined) throw new Error("Native remote engine is unavailable");
    const envelope = parseJson<NativeEngineResult<T>>(
      await bridge.engineRpc(this.connectionId, method, JSON.stringify(params ?? null)),
      "native RPC response",
    );
    if (this.#stopped) throw new Error("Native connection session was replaced");
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
        void this.#connectionState.setConnectionState(this.connectionId, "degraded", nativeEngineErrorDiagnostic(cause, "Native projection recovery failed"));
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

  constructor(options: NativeEngineSupervisorOptions) {
    this.#connectionState = options.connectionState;
    this.#projection = options.projection;
    this.#onPendingRequests = options.onPendingRequests;
    this.#onOutboxChange = options.onOutboxChange;
    this.#subscription = bridge === undefined
      ? null
      : new NativeEventEmitter(NativeModules.CodeWideNative).addListener("CodeWideEngineEvent", (event: NativeEngineEvent) => {
        if ((event.contractVersion === 1 || event.contractVersion === 2) && event.type === "outbox") {
          try {
            const payload: unknown = JSON.parse(event.data);
            recordNativeOutboxStorage(event.connectionId, payload);
            this.#onOutboxChange?.(parseNativeCommandDelivery(payload));
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

  async reattachRuntime(connectionId: string): Promise<void> {
    const session = this.#sessions.get(connectionId);
    if (session === undefined) return;
    await session.reattachRuntime();
  }

  stop(): void {
    for (const session of this.#sessions.values()) session.stop();
    this.#sessions.clear();
    this.#fingerprints.clear();
    this.#subscription?.remove();
  }
}

function recordNativeOutboxStorage(connectionId: string, value: unknown): void {
  if (value === null || typeof value !== "object") return;
  const projection = value as Record<string, unknown>;
  const storage = projection.storage;
  if (storage === null || typeof storage !== "object") return;
  const fields = storage as Record<string, unknown>;
  const numeric = [
    "rowCount",
    "payloadBytes",
    "pendingRows",
    "pendingBytes",
    "deliveredRows",
    "failedRows",
    "mainFileBytes",
    "walFileBytes",
    "shmFileBytes",
  ] as const;
  if (!numeric.every((field) => typeof fields[field] === "number" && Number.isSafeInteger(fields[field]))) return;
  const threadId = typeof projection.threadId === "string" ? projection.threadId : undefined;
  recordTelemetryEvent(connectionId, {
    name: "outbox.native_sqlite_storage",
    ...(threadId === undefined ? {} : { sessionId: threadId, threadId }),
    values: Object.fromEntries(numeric.map((field) => [field, fields[field] as number])),
    tags: { state: typeof projection.state === "string" ? projection.state : "unknown" },
  });
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

function parseNativeTelemetry(raw: string): TelemetryEventInput | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const name = Reflect.get(value, "name");
  if (typeof name !== "string") return null;
  const values = numericTelemetryFields(Reflect.get(value, "values"));
  const tags = stringTelemetryFields(Reflect.get(value, "tags"));
  if (values === null || tags === null) return null;
  return {
    name,
    ...(Object.keys(values).length === 0 ? {} : { values }),
    ...(Object.keys(tags).length === 0 ? {} : { tags }),
  };
}

function numericTelemetryFields(value: unknown): Record<string, number> | null {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const result: Record<string, number> = {};
  for (const [name, field] of Object.entries(value)) {
    if (typeof field !== "number" || !Number.isFinite(field)) return null;
    result[name] = field;
  }
  return result;
}

function stringTelemetryFields(value: unknown): Record<string, string> | null {
  if (value === undefined) return {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const result: Record<string, string> = {};
  for (const [name, field] of Object.entries(value)) {
    if (typeof field !== "string") return null;
    result[name] = field;
  }
  return result;
}

function isEventProjectionWork(work: ProjectionWork): work is EventProjectionWork {
  return "eventProjection" in work;
}

function agentMessageDeltaMetric(connectionId: string, event: SyncEvent): { streamKey: string; chars: number; threadId: string; turnId: string; itemId: string } | null {
  if (event.payload.method !== "item/agentMessage/delta") return null;
  const params = event.payload.params;
  if (params === null || typeof params !== "object" || Array.isArray(params)) return null;
  const value = params as Record<string, unknown>;
  if (typeof value.delta !== "string") return null;
  const streamKey = liveStreamMetricKey(connectionId, value.threadId, value.turnId, value.itemId);
  return streamKey === null ? null : {
    streamKey,
    chars: value.delta.length,
    threadId: value.threadId as string,
    turnId: value.turnId as string,
    itemId: value.itemId as string,
  };
}
