import type {
  NativeDomainProjection,
  NativeConnectionStateProjection,
  NativeEngineSupervisorOptions,
  NativeLiveRealtimeEvent,
} from "./native-engine-contract";
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
import { unknownRecord } from "../data/unknownRecord";
import {
  incrementDiagnosticMetric,
  liveStreamMetricKey,
  markLiveBatchDelivered,
  operationalDiagnosticsEnabled,
  recordDiagnosticTiming,
} from "../data/operational-metrics";
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
  connectionId: string;
  contractVersion: 1 | 2;
  data: string;
  frameId?: number;
  projectionCursor?: number;
  type:
    | "state"
    | "snapshot"
    | "pendingRequests"
    | "events"
    | "checkpointEvents"
    | "journalAdvanced"
    | "liveEvent"
    | "liveSubscribed"
    | "liveTerminal"
    | "outbox"
    | "telemetry";
};

type NativeLiveEventType = Extract<
  NativeEngineEvent["type"],
  "liveEvent" | "liveSubscribed" | "liveTerminal"
>;

type NativeEngineState = {
  error?: string;
  rpcAvailable: boolean;
  state: RemoteConnectionState;
};

function safeIntegerOrZero(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : 0;
}

type NativeEngineResult<T> =
  | { ok: true; result: T }
  | { code?: number; message: string; ok: false };

type NativeBridge = {
  acknowledgeProjection: (connectionId: string, projectionCursor: number) => void;
  addListener: (eventName: string) => void;
  attachSocket: (connectionId: string) => Promise<void>;
  engineLiveSubscribe: (connectionId: string, channelId: string, threadId: string) => Promise<void>;
  engineLiveUnsubscribe: (connectionId: string, channelId: string) => Promise<void>;
  engineRpc: (connectionId: string, method: string, paramsJson: string) => Promise<string>;
  readCommittedFrames: (
    connectionId: string,
    afterCursor: number | null,
  ) => Promise<NativeCommittedFramePage>;
  removeListeners: (count: number) => void;
  wakeSocket: (connectionId: string) => void;
};

type NativeCommittedFramePage = {
  baseCursor?: number;
  frames: Array<{ cursor: number; payload: string }>;
  headCursor?: number;
};

// WHY: React Native owns this same-binary registry and exposes no generated TypeScript contract for the registered module.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const bridge = NativeModules.CodeWideNative as NativeBridge | undefined;
const MAX_COALESCED_LIVE_EVENTS = 1024;

type EventProjectionWork = ProjectionWork & {
  readonly eventProjection: {
    checkpoint: Promise<void>;
    events: SyncEvent[];
    flushBoundary: boolean;
    projectionCursor: number;
  };
};

export class NativeEngineSession implements RpcClient {
  readonly connectionId: string;
  readonly #connectionState: NativeConnectionStateProjection;
  readonly #projection: NativeDomainProjection;
  readonly #onPendingRequests:
    | ((connectionId: string, requests: SyncServerRequest[]) => void)
    | undefined;
  readonly #onEvents: ((connectionId: string, events: readonly SyncEvent[]) => void) | undefined;
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
  #livePublication: Promise<void> | undefined;

  constructor(options: {
    connection: RemoteConnection;
    connectionState: NativeConnectionStateProjection;
    onEvents?: (connectionId: string, events: readonly SyncEvent[]) => void;
    onPendingRequests?: (connectionId: string, requests: SyncServerRequest[]) => void;
    projection: NativeDomainProjection;
  }) {
    this.connectionId = options.connection.id;
    this.#connectionState = options.connectionState;
    this.#projection = options.projection;
    this.#onPendingRequests = options.onPendingRequests;
    this.#onEvents = options.onEvents;
    const projectionFailed = (error: unknown) => {
      this.#publishedLiveRpcAvailable = undefined;
      this.#stateGeneration += 1;
      this.#journalReadCursor = undefined;
      this.#publishConnectionState(
        "degraded",
        nativeEngineErrorDiagnostic(error, "Native projection update failed"),
      );
      this.#scheduleProjectionRecovery();
    };
    this.#projectionGate = new OrderedProjectionGate(projectionFailed);
    this.#projectionAcknowledger = new OrderedProjectionAcknowledger(projectionFailed);
  }

  start(): void {
    this.#publishedLiveRpcAvailable = undefined;
    if (bridge === undefined) {
      this.#publishConnectionState(
        "degraded",
        "Native remote engine is unavailable in this build",
        false,
      );
      return;
    }
    this.#publishConnectionState("connecting", null, false);
    bridge.attachSocket(this.connectionId).catch((error: unknown) => {
      this.#publishConnectionState(
        "degraded",
        nativeEngineErrorDiagnostic(error, "Could not start native remote engine"),
        false,
      );
    });
  }

  async reattachRuntime(): Promise<void> {
    if (this.#stopped || bridge === undefined) {
      return;
    }
    await bridge.attachSocket(this.connectionId);
  }

  stop(): void {
    this.#stopped = true;
    if (this.#projectionRecoveryTimer !== undefined) {
      clearTimeout(this.#projectionRecoveryTimer);
    }
    this.#projectionRecoveryTimer = undefined;
    this.#journalHeadCursor = undefined;
    this.#journalReadCursor = undefined;
  }

  receive(event: NativeEngineEvent): void {
    if (this.#stopped) {
      return;
    }
    // WHY: Native event payloads cross an untyped bridge at runtime even though this internal adapter exposes the validated union downstream.
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (event.contractVersion !== 1 && event.contractVersion !== 2) {
      this.#publishedLiveRpcAvailable = undefined;
      this.#publishConnectionState(
        "degraded",
        "Native bridge contract version is unsupported",
        false,
      );
      return;
    }
    if (event.type === "telemetry") {
      const telemetry = parseNativeTelemetry(event.data);
      if (telemetry !== null) {
        recordOperationalTelemetryEvent(this.connectionId, telemetry);
      }
      return;
    }
    if (
      event.type === "liveEvent" ||
      event.type === "liveSubscribed" ||
      event.type === "liveTerminal"
    ) {
      return;
    }
    if (event.type === "state") {
      try {
        const state = parseJson<NativeEngineState>(event.data, "native engine state");
        if (typeof state.rpcAvailable !== "boolean") {
          throw new Error("Native engine state omitted RPC availability");
        }
        const generation = ++this.#stateGeneration;
        if (state.state === "live") {
          // The transport can announce caught-up after it emitted the final
          // projection batch, while that batch is still committing to SQLite.
          // Keep the UI in syncing until the ordered durable projection seam
          // has drained; RPC availability remains a separate transport axis.
          // Reattaching an existing JS runtime also emits its unchanged native
          // state. Do not fabricate a reconnect: that edge reloads the chat.
          if (this.#publishedLiveRpcAvailable !== state.rpcAvailable) {
            this.#publishConnectionState("syncing", undefined, state.rpcAvailable);
          }
          const publication: Promise<void> = Promise.resolve(this.#journalDrain)
            .then(async () => this.#projectionGate.settled())
            .then(async () => {
              // The gate enqueues acknowledgement only after applying the batch,
              // so observe its tail after the presentation queue has drained.
              await this.#projectionAcknowledger.settled();
            })
            .then(async () => {
              if (
                this.#stopped ||
                generation !== this.#stateGeneration ||
                this.#projectionGate.blocked ||
                this.#projectionAcknowledger.blocked
              ) {
                return;
              }
              if (this.#publishedLiveRpcAvailable === state.rpcAvailable) {
                return;
              }
              this.#publishedLiveRpcAvailable = state.rpcAvailable;
              await this.#connectionState.setConnectionState(
                this.connectionId,
                "live",
                null,
                state.rpcAvailable,
              );
            })
            .catch((error: unknown) => {
              this.#handleProjectionFailure(error);
            })
            .finally(() => {
              if (this.#livePublication === publication) {
                this.#livePublication = undefined;
              }
            });
          this.#livePublication = publication;
        } else {
          this.#publishedLiveRpcAvailable = undefined;
          this.#publishConnectionState(state.state, state.error, state.rpcAvailable);
        }
      } catch (error: unknown) {
        this.#publishedLiveRpcAvailable = undefined;
        this.#publishConnectionState(
          "degraded",
          nativeEngineErrorDiagnostic(error, "Native engine state is invalid"),
          false,
        );
      }
      return;
    }
    if (event.type === "pendingRequests") {
      try {
        const requests = parseJson<SyncServerRequest[]>(event.data, "pending server requests");
        if (!Array.isArray(requests)) {
          throw new Error("Native pending request projection is invalid");
        }
        this.#onPendingRequests?.(this.connectionId, requests);
      } catch (error: unknown) {
        this.#publishedLiveRpcAvailable = undefined;
        this.#publishConnectionState(
          "degraded",
          nativeEngineErrorDiagnostic(error, "Native pending request projection is invalid"),
        );
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
          bytes?: number;
          commitMs?: number;
          eventCount?: number;
          journalFrameCount?: number;
          journalPayloadBytes?: number;
          mainFileBytes?: number;
          recovery?: boolean;
          shmFileBytes?: number;
          walFileBytes?: number;
        }>(event.data, "native journal signal");
        if (operationalDiagnosticsEnabled() && signal.recovery !== true) {
          if (typeof signal.commitMs === "number") {
            recordDiagnosticTiming("native_journal_commit_ms", signal.commitMs);
          }
          incrementDiagnosticMetric("native_journal_commits");
          const eventCount = safeIntegerOrZero(signal.eventCount);
          if (eventCount > 0) {
            incrementDiagnosticMetric("native_journal_committed_events", eventCount);
          }
        }
        if (signal.recovery !== true && typeof signal.commitMs === "number") {
          recordTelemetryEvent(this.connectionId, {
            name: "stream.native_journal_commit",
            values: {
              bytes: safeIntegerOrZero(signal.bytes),
              commitMs: signal.commitMs,
              eventCount: safeIntegerOrZero(signal.eventCount),
              journalFrameCount: safeIntegerOrZero(signal.journalFrameCount),
              journalPayloadBytes: safeIntegerOrZero(signal.journalPayloadBytes),
              mainFileBytes: safeIntegerOrZero(signal.mainFileBytes),
              shmFileBytes: safeIntegerOrZero(signal.shmFileBytes),
              walFileBytes: safeIntegerOrZero(signal.walFileBytes),
            },
          });
        }
        this.#requestJournalDrain(projectionCursor, signal.recovery === true);
      } catch (error: unknown) {
        this.#enqueueProjectionFailure(error, true);
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
        const snapshot = parseJson<{ cursor: number; threads: SyncSnapshotThread[] }>(
          event.data,
          "native snapshot",
        );
        if (!Number.isSafeInteger(snapshot.cursor) || !Array.isArray(snapshot.threads)) {
          throw new Error("Native snapshot is invalid");
        }
        if (projectionCursor !== snapshot.cursor) {
          throw new Error("Native snapshot projection cursor is invalid");
        }
        this.#journalReadCursor = snapshot.cursor;
        this.#projectionGate.enqueue({
          acknowledge: () => {
            this.#projectionAcknowledger.enqueue({
              acknowledge: () => {
                if (!this.#stopped) {
                  bridge?.acknowledgeProjection(this.connectionId, snapshot.cursor);
                }
              },
              checkpoint: Promise.resolve(),
              recovery: true,
            });
          },
          apply: async () => {
            if (this.#stopped) {
              return;
            }
            await this.#projection.applySnapshot(
              this.connectionId,
              snapshot.threads,
              snapshot.cursor,
            );
            this.#projectionRecovered();
          },
          recovery: true,
        });
        return;
      }
      const measureDiagnostics = operationalDiagnosticsEnabled();
      const decodeStartedAt = measureDiagnostics ? performance.now() : 0;
      const frames = parseJson<unknown>(event.data, "native event batch");
      if (measureDiagnostics) {
        recordDiagnosticTiming("native_json_decode_ms", performance.now() - decodeStartedAt);
      }
      if (!Array.isArray(frames) || frames.length === 0) {
        throw new Error("Native event projection is invalid");
      }
      const syncEvents = frames.map((rawFrame) => {
        const frameEnvelope = unknownRecord(rawFrame);
        const frame = unknownRecord(frameEnvelope?.frame);
        const payload = unknownRecord(frame?.payload);
        if (
          frame === null ||
          frame.type !== "event" ||
          typeof frame.cursor !== "number" ||
          !Number.isSafeInteger(frame.cursor) ||
          payload === null
        ) {
          throw new Error("Native event projection is invalid");
        }
        return { cursor: frame.cursor, payload } satisfies SyncEvent;
      });
      if (projectionCursor !== syncEvents.at(-1)?.cursor) {
        throw new Error("Native event projection cursor is invalid");
      }
      const recovery = event.type === "checkpointEvents";
      this.#enqueueSyncEvents(syncEvents, projectionCursor, recovery, event.data.length);
    } catch (error: unknown) {
      this.#enqueueProjectionFailure(error, event.type === "checkpointEvents");
    }
  }

  #requestJournalDrain(headCursor: number, recovery: boolean): void {
    // The same runtime already owns everything through this cursor, including
    // any queued writes. A failed write clears the cursor in projectionFailed.
    if (this.#journalReadCursor !== undefined && headCursor <= this.#journalReadCursor) {
      return;
    }
    if (recovery) {
      this.#publishedLiveRpcAvailable = undefined;
    }
    this.#journalHeadCursor = Math.max(this.#journalHeadCursor ?? headCursor, headCursor);
    this.#journalRecoveryRequested ||= recovery;
    if (this.#journalDrain !== undefined || bridge === undefined) {
      return;
    }
    const drain = this.#drainCommittedJournal();
    this.#journalDrain = drain;
    void drain
      .catch((error: unknown) => {
        this.#journalHeadCursor = undefined;
        this.#journalReadCursor = undefined;
        this.#enqueueProjectionFailure(error, true);
      })
      .finally(() => {
        if (this.#journalDrain === drain) {
          this.#journalDrain = undefined;
        }
        const head = this.#journalHeadCursor;
        if (!this.#stopped && head !== undefined && (this.#journalReadCursor ?? -1) < head) {
          this.#requestJournalDrain(head, this.#journalRecoveryRequested);
        }
      });
  }

  async #drainCommittedJournal(): Promise<void> {
    if (bridge === undefined) {
      return;
    }
    while (!this.#stopped) {
      const requestedHead = this.#journalHeadCursor;
      if (requestedHead === undefined) {
        return;
      }
      const page = await bridge.readCommittedFrames(
        this.connectionId,
        this.#journalReadCursor ?? null,
      );
      if (!Array.isArray(page.frames)) {
        throw new Error("Native committed frame page is invalid");
      }
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
        this.#journalHeadCursor = Math.max(
          this.#journalHeadCursor ?? page.headCursor,
          page.headCursor,
        );
      }
      if (page.frames.length === 0) {
        if ((this.#journalReadCursor ?? -1) >= requestedHead) {
          if (this.#journalHeadCursor === requestedHead) {
            this.#journalHeadCursor = undefined;
          }
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
        const envelope = unknownRecord(
          parseJson<unknown>(stored.payload, "native committed frame"),
        );
        const payload = unknownRecord(envelope?.payload);
        rawBytes += stored.payload.length;
        if (
          envelope === null ||
          envelope.type !== "event" ||
          envelope.cursor !== stored.cursor ||
          payload === null
        ) {
          throw new Error("Native committed frame envelope is invalid");
        }
        previousCursor = stored.cursor;
        return { cursor: stored.cursor, payload } satisfies SyncEvent;
      });
      if (operationalDiagnosticsEnabled()) {
        recordDiagnosticTiming("native_json_decode_ms", performance.now() - decodeStartedAt);
      }
      const latestEvent = syncEvents.at(-1);
      if (latestEvent === undefined) {
        throw new Error("Native journal page produced no sync events");
      }
      const projectionCursor = latestEvent.cursor;
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

  #enqueueSyncEvents(
    events: SyncEvent[],
    projectionCursor: number,
    recovery: boolean,
    bridgeBytes: number,
  ): void {
    const measureDiagnostics = operationalDiagnosticsEnabled();
    if (measureDiagnostics) {
      incrementDiagnosticMetric("native_event_batches");
      incrementDiagnosticMetric("native_event_bytes", bridgeBytes);
      incrementDiagnosticMetric("native_events", events.length);
      if (!recovery && shouldFlushLiveEventsImmediately(events)) {
        incrementDiagnosticMetric("live_immediate_flushes");
      }
    }
    const liveIngress = new Map<string, NonNullable<ReturnType<typeof agentMessageDeltaMetric>>>();
    for (const syncEvent of events) {
      const delta = agentMessageDeltaMetric(this.connectionId, syncEvent);
      if (delta === null) {
        continue;
      }
      const previous = liveIngress.get(delta.streamKey);
      liveIngress.set(
        delta.streamKey,
        previous === undefined ? delta : { ...delta, chars: previous.chars + delta.chars },
      );
    }
    for (const delta of liveIngress.values()) {
      recordTelemetryEvent(this.connectionId, {
        itemId: delta.itemId,
        name: "stream.native_bridge_batch",
        sessionId: delta.threadId,
        threadId: delta.threadId,
        turnId: delta.turnId,
        values: { bridgeBytes, deltaChars: delta.chars, eventCount: events.length },
      });
    }
    this.#projectionGate.enqueue(this.#eventProjectionWork(events, projectionCursor, recovery));
  }

  #enqueueProjectionFailure(error: unknown, recovery: boolean): void {
    this.#projectionGate.enqueue({
      acknowledge: () => undefined,
      apply: async () => {
        await Promise.resolve();
        throw error;
      },
      recovery,
    });
  }

  #eventProjectionWork(
    events: SyncEvent[],
    projectionCursor: number,
    recovery: boolean,
  ): EventProjectionWork {
    const eventProjection = {
      checkpoint: Promise.resolve(),
      events: [...events],
      flushBoundary: shouldFlushLiveEventsImmediately(events),
      projectionCursor,
    };
    const work: EventProjectionWork = {
      acknowledge: () => {
        this.#projectionAcknowledger.enqueue({
          acknowledge: () => {
            if (!this.#stopped) {
              bridge?.acknowledgeProjection(this.connectionId, eventProjection.projectionCursor);
            }
          },
          checkpoint: eventProjection.checkpoint,
          recovery,
        });
      },
      apply: async () => {
        if (this.#stopped) {
          return;
        }
        const measureDiagnostics = operationalDiagnosticsEnabled();
        const startedAt = performance.now();
        const projected = await this.#projection.applyEvents(
          this.connectionId,
          eventProjection.events,
        );
        const projectionMs = performance.now() - startedAt;
        if (projectionMs >= 50) {
          recordOperationalTelemetryEvent(this.connectionId, {
            name: "sync.projection_slow",
            tags: { measurement: "elapsed_including_await", mode: recovery ? "recovery" : "live" },
            values: { durationMs: projectionMs, eventCount: eventProjection.events.length },
          });
        }
        if (measureDiagnostics) {
          recordDiagnosticTiming("projection_apply_ms", projectionMs);
        }
        if (!recovery) {
          this.#onEvents?.(this.connectionId, eventProjection.events);
          const liveDeltas = eventProjection.events.flatMap((event) => {
            const delta = agentMessageDeltaMetric(this.connectionId, event);
            return delta === null ? [] : [delta];
          });
          if (measureDiagnostics) {
            incrementDiagnosticMetric("live_events", liveDeltas.length);
          }
          const charsByStream = new Map<string, number>();
          for (const delta of liveDeltas) {
            charsByStream.set(
              delta.streamKey,
              (charsByStream.get(delta.streamKey) ?? 0) + delta.chars,
            );
          }
          for (const [streamKey, chars] of charsByStream) {
            markLiveBatchDelivered(streamKey, chars, {
              eventCount: eventProjection.events.length,
              projectionMs,
            });
          }
        }
        eventProjection.checkpoint = projected.checkpoint;
        if (recovery) {
          this.#projectionRecovered();
        }
      },
      eventProjection,
      mergeWith: (newer) => {
        if (
          recovery ||
          eventProjection.flushBoundary ||
          !isEventProjectionWork(newer) ||
          newer.recovery
        ) {
          return null;
        }
        if (
          eventProjection.events.length + newer.eventProjection.events.length >
          MAX_COALESCED_LIVE_EVENTS
        ) {
          return null;
        }
        eventProjection.events.push(...newer.eventProjection.events);
        eventProjection.projectionCursor = newer.eventProjection.projectionCursor;
        eventProjection.flushBoundary = newer.eventProjection.flushBoundary;
        return work;
      },
      recovery,
    };
    return work;
  }

  async rpc<T>(method: string, params: unknown): Promise<T> {
    if (this.#stopped) {
      throw new Error("Native connection session was replaced");
    }
    if (bridge === undefined) {
      throw new Error("Native remote engine is unavailable");
    }
    const envelope = parseJson<NativeEngineResult<T>>(
      await bridge.engineRpc(this.connectionId, method, JSON.stringify(params ?? null)),
      "native RPC response",
    );
    // WHY: stop() may run while the awaited native RPC is pending; TypeScript retains the earlier live-session narrowing.
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (this.#stopped) {
      throw new Error("Native connection session was replaced");
    }
    if (envelope.ok) {
      return envelope.result;
    }
    if (typeof envelope.code === "number") {
      throw new RpcResponseError(envelope.code, envelope.message);
    }
    throw new Error(envelope.message);
  }

  #scheduleProjectionRecovery(): void {
    if (this.#stopped || bridge === undefined || this.#projectionRecoveryTimer !== undefined) {
      return;
    }
    const delay = Math.min(30_000, 500 * 2 ** Math.min(this.#projectionRecoveryAttempt++, 6));
    this.#projectionRecoveryTimer = setTimeout(() => {
      this.#projectionRecoveryTimer = undefined;
      if (this.#stopped) {
        return;
      }
      bridge.attachSocket(this.connectionId).catch((error: unknown) => {
        this.#publishConnectionState(
          "degraded",
          nativeEngineErrorDiagnostic(error, "Native projection recovery failed"),
        );
        this.#scheduleProjectionRecovery();
      });
    }, delay);
  }

  #publishConnectionState(
    state: RemoteConnectionState,
    diagnostic?: string | null,
    rpcAvailable?: boolean,
  ): void {
    Promise.resolve(
      this.#connectionState.setConnectionState(this.connectionId, state, diagnostic, rpcAvailable),
    ).catch(() => undefined);
  }

  #handleProjectionFailure(error: unknown): void {
    this.#publishedLiveRpcAvailable = undefined;
    this.#stateGeneration += 1;
    this.#journalReadCursor = undefined;
    this.#publishConnectionState(
      "degraded",
      nativeEngineErrorDiagnostic(error, "Native projection update failed"),
    );
    this.#scheduleProjectionRecovery();
  }

  #projectionRecovered(): void {
    this.#projectionRecoveryAttempt = 0;
    if (this.#projectionRecoveryTimer !== undefined) {
      clearTimeout(this.#projectionRecoveryTimer);
    }
    this.#projectionRecoveryTimer = undefined;
  }
}

export class NativeEngineSupervisor {
  readonly #connectionState: NativeConnectionStateProjection;
  readonly #projection: NativeDomainProjection;
  readonly #onPendingRequests:
    | ((connectionId: string, requests: SyncServerRequest[]) => void)
    | undefined;
  readonly #onOutboxChange: ((delivery: NativeCommandDelivery) => void) | undefined;
  readonly #onEvents: ((connectionId: string, events: readonly SyncEvent[]) => void) | undefined;
  readonly #onLiveRealtime:
    | ((connectionId: string, event: NativeLiveRealtimeEvent) => void)
    | undefined;
  readonly #sessions = new Map<string, NativeEngineSession>();
  readonly #fingerprints = new Map<string, string>();
  readonly #subscription: { remove: () => void } | null;

  constructor(options: NativeEngineSupervisorOptions) {
    this.#connectionState = options.connectionState;
    this.#projection = options.projection;
    this.#onPendingRequests = options.onPendingRequests;
    this.#onOutboxChange = options.onOutboxChange;
    this.#onEvents = options.onEvents;
    this.#onLiveRealtime = options.onLiveRealtime;
    this.#subscription =
      bridge === undefined
        ? null
        : new NativeEventEmitter(bridge).addListener(
            "CodeWideEngineEvent",
            (event: NativeEngineEvent) => {
              this.#receiveBridgeEvent(event);
            },
          );
  }

  #publishLiveRealtime(event: NativeEngineEvent): void {
    if (
      event.type !== "liveEvent" &&
      event.type !== "liveSubscribed" &&
      event.type !== "liveTerminal"
    ) {
      return;
    }
    const liveEvent = parseNativeLiveRealtimeEvent(event.type, event.data);
    if (liveEvent !== null) {
      this.#onLiveRealtime?.(event.connectionId, liveEvent);
    }
  }

  #publishOutbox(event: NativeEngineEvent): void {
    if (
      // WHY: NativeEventEmitter delivers untyped runtime data even though this adapter annotates the validated event shape.
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      (event.contractVersion !== 1 && event.contractVersion !== 2) ||
      event.type !== "outbox"
    ) {
      return;
    }
    try {
      const payload: unknown = JSON.parse(event.data);
      recordNativeOutboxStorage(event.connectionId, payload);
      this.#onOutboxChange?.(parseNativeCommandDelivery(payload));
    } catch {
      // Malformed native projections are never repaired with an
      // unbounded cross-server rescan.
    }
  }

  #receiveBridgeEvent(event: NativeEngineEvent): void {
    this.#publishOutbox(event);
    this.#publishLiveRealtime(event);
    this.#sessions.get(event.connectionId)?.receive(event);
  }

  replaceConnections(connections: RemoteConnection[]): void {
    const enabled = connections.filter((connection) => connection.enabled);
    const wanted = new Map(enabled.map((connection) => [connection.id, fingerprint(connection)]));
    for (const [id, session] of this.#sessions) {
      if (wanted.get(id) === this.#fingerprints.get(id)) {
        continue;
      }
      session.stop();
      this.#sessions.delete(id);
      this.#fingerprints.delete(id);
    }
    for (const connection of enabled) {
      if (this.#sessions.has(connection.id)) {
        continue;
      }
      const session = new NativeEngineSession({
        connection,
        connectionState: this.#connectionState,
        ...(this.#onEvents === undefined ? {} : { onEvents: this.#onEvents }),
        projection: this.#projection,
        ...(this.#onPendingRequests === undefined
          ? {}
          : { onPendingRequests: this.#onPendingRequests }),
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
    if (session === undefined) {
      return;
    }
    await session.reattachRuntime();
  }

  async subscribeLive(connectionId: string, channelId: string, threadId: string): Promise<void> {
    if (bridge === undefined) {
      throw new Error("Native live subscription is unavailable");
    }
    await bridge.engineLiveSubscribe(connectionId, channelId, threadId);
  }

  async unsubscribeLive(connectionId: string, channelId: string): Promise<void> {
    if (bridge === undefined) {
      throw new Error("Native live subscription is unavailable");
    }
    await bridge.engineLiveUnsubscribe(connectionId, channelId);
  }

  stop(): void {
    for (const session of this.#sessions.values()) {
      session.stop();
    }
    this.#sessions.clear();
    this.#fingerprints.clear();
    this.#subscription?.remove();
  }
}

function parseNativeLiveEnvelope(data: string): Readonly<Record<string, unknown>> | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  return unknownRecord(value);
}

function parseNativeLivePayload(
  envelope: Readonly<Record<string, unknown>>,
  channelId: string,
): NativeLiveRealtimeEvent | null {
  const payload = unknownRecord(envelope.payload);
  const sequence = envelope.sequence;
  const threadId = envelope.threadId;
  return payload !== null &&
    typeof sequence === "number" &&
    Number.isSafeInteger(sequence) &&
    typeof threadId === "string" &&
    threadId.length > 0
    ? { channelId, event: "payload", payload, sequence, threadId }
    : null;
}

function nonEmptyNativeString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function parseNativeLiveSubscribed(
  envelope: Readonly<Record<string, unknown>>,
  channelId: string,
): NativeLiveRealtimeEvent | null {
  const threadId = nonEmptyNativeString(envelope.threadId);
  return threadId === null ? null : { channelId, event: "subscribed", threadId };
}

function parseNativeLiveTerminal(
  envelope: Readonly<Record<string, unknown>>,
  channelId: string,
): NativeLiveRealtimeEvent | null {
  const reason = nonEmptyNativeString(envelope.reason);
  return reason === null ? null : { channelId, event: "terminal", reason };
}

function parseNativeLiveRealtimeEvent(
  type: NativeLiveEventType,
  data: string,
): NativeLiveRealtimeEvent | null {
  const envelope = parseNativeLiveEnvelope(data);
  if (envelope === null) {
    return null;
  }
  const channelId = nonEmptyNativeString(envelope.channelId);
  if (channelId === null) {
    return null;
  }
  if (type === "liveEvent") {
    return parseNativeLivePayload(envelope, channelId);
  }
  return type === "liveSubscribed"
    ? parseNativeLiveSubscribed(envelope, channelId)
    : parseNativeLiveTerminal(envelope, channelId);
}

function recordNativeOutboxStorage(connectionId: string, value: unknown): void {
  const projection = unknownRecord(value);
  if (projection === null) {
    return;
  }
  const fields = unknownRecord(projection.storage);
  if (fields === null) {
    return;
  }
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
  const values: Record<string, number> = {};
  for (const field of numeric) {
    const metric = fields[field];
    if (typeof metric !== "number" || !Number.isSafeInteger(metric)) {
      return;
    }
    values[field] = metric;
  }
  const threadId = typeof projection.threadId === "string" ? projection.threadId : undefined;
  recordTelemetryEvent(connectionId, {
    name: "outbox.native_sqlite_storage",
    ...(threadId === undefined ? {} : { sessionId: threadId, threadId }),
    tags: { state: typeof projection.state === "string" ? projection.state : "unknown" },
    values,
  });
}

function fingerprint(connection: RemoteConnection): string {
  return JSON.stringify([connection.endpoint, connection.tlsPinSha256 ?? null]);
}

function parseJson<T>(raw: string, label: string): T {
  try {
    const value: unknown = JSON.parse(raw);
    // WHY: NativeEngine implements RpcClient's generic transport contract; method owners validate their concrete response DTO after this JSON framing boundary.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return value as T;
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
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const name = "name" in value ? value.name : undefined;
  if (typeof name !== "string") {
    return null;
  }
  const values = numericTelemetryFields("values" in value ? value.values : undefined);
  const tags = stringTelemetryFields("tags" in value ? value.tags : undefined);
  if (values === null || tags === null) {
    return null;
  }
  return {
    name,
    ...(Object.keys(values).length === 0 ? {} : { values }),
    ...(Object.keys(tags).length === 0 ? {} : { tags }),
  };
}

function numericTelemetryFields(value: unknown): Record<string, number> | null {
  if (value === undefined) {
    return {};
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const result: Record<string, number> = {};
  for (const [name, field] of Object.entries(value)) {
    if (typeof field !== "number" || !Number.isFinite(field)) {
      return null;
    }
    result[name] = field;
  }
  return result;
}

function stringTelemetryFields(value: unknown): Record<string, string> | null {
  if (value === undefined) {
    return {};
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const result: Record<string, string> = {};
  for (const [name, field] of Object.entries(value)) {
    if (typeof field !== "string") {
      return null;
    }
    result[name] = field;
  }
  return result;
}

function isEventProjectionWork(work: ProjectionWork): work is EventProjectionWork {
  return "eventProjection" in work;
}

function agentMessageDeltaMetric(
  connectionId: string,
  event: SyncEvent,
): { chars: number; itemId: string; streamKey: string; threadId: string; turnId: string } | null {
  if (event.payload.method !== "item/agentMessage/delta") {
    return null;
  }
  const value = unknownRecord(event.payload.params);
  if (value === null) {
    return null;
  }
  if (
    typeof value.delta !== "string" ||
    typeof value.threadId !== "string" ||
    typeof value.turnId !== "string" ||
    typeof value.itemId !== "string"
  ) {
    return null;
  }
  const streamKey = liveStreamMetricKey(connectionId, value.threadId, value.turnId, value.itemId);
  return streamKey === null
    ? null
    : {
        chars: value.delta.length,
        itemId: value.itemId,
        streamKey,
        threadId: value.threadId,
        turnId: value.turnId,
      };
}
