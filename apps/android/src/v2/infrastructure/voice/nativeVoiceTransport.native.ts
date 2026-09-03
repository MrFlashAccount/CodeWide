import { NativeEventEmitter, NativeModules, PermissionsAndroid } from "react-native";
import {
  parseV2VoiceServerRecord,
  validateV2VoiceClientRecord,
  type V2VoiceClientRecord,
} from "@codewide/sync-client/v2";

import type {
  VoiceSessionHandle,
  VoiceTransport,
  VoiceTransportEvent,
} from "../../application/ports/voiceTransport";
import {
  acquireSharedConnectionLease,
  type AuthenticatedDuplexChannel,
} from "../connection/sharedConnectionAdapter.native";
import { VoiceBatchFlow } from "./voiceBatchFlow";

interface NativeVoiceCapture {
  prepare(captureId: string): Promise<void>;
  start(captureId: string): Promise<{ numChannels: number; sampleRate: number }>;
  stop(): void;
  finishAura(): void;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

interface NativeCaptureEvent {
  captureId: string;
  data?: string;
  level?: number;
  numChannels?: number;
  sampleRate?: number;
  samplesPerChannel?: number;
  type: "batch" | "stopped";
}

const EVENT = "codewideV2VoiceCapture";

// WHY: React Native's module registry is untyped; this assertion narrows the named capture module.
const capture = NativeModules["CodeWideV2VoiceCapture"] as NativeVoiceCapture | undefined;
const events = capture === undefined ? null : new NativeEventEmitter(capture);

/**
 * Owns one generation-bound Voice websocket and its matching native microphone
 * capture. It never exposes lease details or native audio records to features.
 */
export function createNativeVoiceTransport(captureId: () => string): VoiceTransport {
  return {
    async start(input): Promise<VoiceSessionHandle> {
      if (capture === undefined || events === null) throw new Error("Voice capture is unavailable");
      const id = captureId();
      const stopPreparedCapture = (): void => {
        capture.stop();
        capture.finishAura();
      };
      const permission = await abortableStart(
        PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO),
        input.signal,
        stopPreparedCapture,
      );
      if (permission !== PermissionsAndroid.RESULTS.GRANTED)
        throw new Error("Microphone permission was denied");
      await abortableStart(capture.prepare(id), input.signal, stopPreparedCapture);
      const connection = await abortableStart(
        acquireSharedConnectionLease(input.audience),
        input.signal,
        stopPreparedCapture,
        (lateConnection) => {
          void lateConnection.lease.release().catch(() => undefined);
        },
      );
      let channel: AuthenticatedDuplexChannel;
      try {
        channel = connection.lease.openDuplex("voice-v2");
      } catch (cause) {
        capture.stop();
        capture.finishAura();
        await connection.lease.release();
        throw cause;
      }
      let sessionId: string | null = null;
      let sequence = 0;
      let captureActive = false;
      let captureStopping = false;
      let cancelling = false;
      let settled = false;
      let handleResolved = false;
      let batchFlow: VoiceBatchFlow | null = null;
      let releaseCaptureListener: (() => void) | null = null;
      let resolveCaptureStop: (() => void) | null = null;
      let captureStopPromise: Promise<void> | null = null;
      let detachAbort = noop;

      const releaseCapture = (): void => {
        releaseCaptureListener?.();
        releaseCaptureListener = null;
      };
      const settleCaptureStop = (): void => {
        resolveCaptureStop?.();
        resolveCaptureStop = null;
        captureStopPromise = null;
      };
      const discardCapture = (): void => {
        captureStopping = true;
        captureActive = false;
        capture.stop();
        releaseCapture();
        settleCaptureStop();
      };
      const drainCapture = (): Promise<void> => {
        if (!captureActive) return Promise.resolve();
        if (captureStopPromise !== null) return captureStopPromise;
        captureStopping = true;
        const stopping = new Promise<void>((resolve) => {
          resolveCaptureStop = resolve;
        });
        captureStopPromise = stopping;
        capture.stop();
        return stopping;
      };

      const finish = async (): Promise<void> => {
        if (settled) return;
        settled = true;
        detachAbort();
        batchFlow?.close();
        discardCapture();
        capture.finishAura();
        channel.close(1000, "voice_finished");
        await connection.lease.release();
      };
      const report = (event: VoiceTransportEvent): void => {
        try {
          input.onEvent(event);
        } catch {
          // UI observation cannot alter a live voice session.
        }
      };

      return new Promise<VoiceSessionHandle>((resolve, reject) => {
        const failStart = (message: string): void => {
          if (handleResolved) {
            report({ type: "error" });
            void finish().catch(() => undefined);
            return;
          }
          void finish().catch(() => undefined);
          reject(new Error(message));
        };
        const abortStart = (): void => {
          if (handleResolved || settled) return;
          cancelling = true;
          if (sessionId !== null && channel.readyState === 1) {
            try {
              send({ sessionId, type: "cancel" });
            } catch {
              // Closing the owned channel below is the cancellation fallback.
            }
          }
          void finish().catch(() => undefined);
          reject(abortedVoiceStart());
        };
        input.signal.addEventListener("abort", abortStart, { once: true });
        detachAbort = (): void => input.signal.removeEventListener("abort", abortStart);
        if (input.signal.aborted) {
          abortStart();
          return;
        }
        const send = (record: V2VoiceClientRecord): void => {
          if (settled || channel.readyState !== 1)
            throw new Error("Voice transport is unavailable");
          channel.send(JSON.stringify(validateV2VoiceClientRecord(record)));
        };
        const onCapture = (raw: unknown): void => {
          const event = parseCaptureEvent(raw);
          if (event === null || event.captureId !== id) return;
          if (event.type === "stopped") {
            const unexpected = captureActive && !captureStopping;
            captureActive = false;
            releaseCapture();
            settleCaptureStop();
            if (unexpected) {
              failStart("Microphone capture stopped");
            }
            return;
          }
          if (!captureActive || sessionId === null) return;
          const { data, level, numChannels, sampleRate, samplesPerChannel } = event;
          if (
            data === undefined ||
            numChannels === undefined ||
            sampleRate === undefined ||
            samplesPerChannel === undefined
          )
            return;
          try {
            if (level !== undefined) report({ level, type: "level" });
            const flow = batchFlow;
            if (flow === null) throw new Error("Voice batch flow is unavailable");
            flow.append({
              data,
              numChannels,
              sampleRate,
              samplesPerChannel,
              sequence: String(sequence++),
              sessionId,
              type: "batch",
            });
          } catch {
            report({ type: "error" });
            void finish().catch(() => undefined);
          }
        };

        channel.addEventListener("open", () => {
          try {
            send({
              generation: input.sourceGeneration,
              inputScope: {
                id: input.scope.id,
                kind: input.scope.kind === "composer" ? "chat" : input.scope.kind,
              },
              language: null,
              threadId: input.thread?.threadId ?? null,
              type: "start",
              version: 2,
            });
          } catch {
            failStart("Voice transport is unavailable");
          }
        });
        channel.addEventListener("message", (event) => {
          if (typeof event.data !== "string" || settled) return;
          try {
            const record = parseV2VoiceServerRecord(event.data);
            if (record.type === "started") {
              if (record.generation !== input.sourceGeneration || sessionId !== null) {
                failStart("Voice generation changed");
                return;
              }
              sessionId = record.sessionId;
              batchFlow = new VoiceBatchFlow({
                sendBatch: send,
                sendFinish: () => {
                  if (sessionId === null) throw new Error("Voice session is unavailable");
                  send({ sessionId, type: "finish" });
                },
              });
              const subscription = events.addListener(EVENT, onCapture);
              releaseCaptureListener = () => subscription.remove();
              captureStopping = false;
              captureActive = true;
              capture
                .start(id)
                .then(() => {
                  if (settled) return;
                  report({ type: "recording" });
                  handleResolved = true;
                  detachAbort();
                  resolve({
                    async cancel() {
                      if (sessionId === null || settled) return;
                      discardCapture();
                      cancelling = true;
                      batchFlow?.close();
                      try {
                        send({ sessionId, type: "cancel" });
                      } catch {
                        report({ type: "error" });
                        await finish();
                      }
                    },
                    async finish() {
                      if (sessionId === null || settled) return;
                      try {
                        await drainCapture();
                        await batchFlow?.finish();
                      } catch {
                        report({ type: "error" });
                        await finish();
                      }
                    },
                  });
                })
                .catch(() => failStart("Microphone is unavailable"));
              return;
            }
            if (sessionId === null || record.sessionId !== sessionId) {
              failStart("Voice session changed");
              return;
            }
            if (record.type === "ack") {
              if (cancelling) return;
              if (batchFlow?.acknowledge(record.sessionId, record.sequence) !== true) {
                report({ type: "error" });
                void finish().catch(() => undefined);
              }
              return;
            }
            if (record.type === "retry") {
              batchFlow?.allowFinishRetry();
              report({ retryAfterMs: record.retryAfterMs, type: "retry" });
              return;
            }
            if (record.type === "result") {
              discardCapture();
              report({ text: record.text, type: "result" });
              void finish().catch(() => undefined);
              return;
            }
            if (record.type === "cancelled") {
              discardCapture();
              report({ type: "cancelled" });
              void finish().catch(() => undefined);
              return;
            }
            report({ type: "error" });
            void finish().catch(() => undefined);
          } catch {
            if (sessionId === null) failStart("Voice returned an invalid record");
            else {
              report({ type: "error" });
              void finish().catch(() => undefined);
            }
          }
        });
        channel.addEventListener("error", () => failStart("Voice transport failed"));
        channel.addEventListener("close", () => {
          if (settled) return;
          if (sessionId === null) failStart("Voice transport closed");
          else {
            report({ type: "error" });
            void finish().catch(() => undefined);
          }
        });
      });
    },
  };
}

function abortableStart<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  onAbort: () => void,
  onLateResolve?: (value: T) => void,
): Promise<T> {
  if (signal.aborted) {
    onAbort();
    void operation.then(onLateResolve, () => undefined);
    return Promise.reject(abortedVoiceStart());
  }
  return new Promise<T>((resolve, reject) => {
    let aborted = false;
    const abort = (): void => {
      aborted = true;
      onAbort();
      reject(abortedVoiceStart());
    };
    signal.addEventListener("abort", abort, { once: true });
    void operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        if (aborted) onLateResolve?.(value);
        else resolve(value);
      },
      (cause: unknown) => {
        signal.removeEventListener("abort", abort);
        if (!aborted)
          reject(cause instanceof Error ? cause : new Error("Voice input start failed"));
      },
    );
  });
}

function abortedVoiceStart(): Error {
  return new Error("Voice input start was cancelled");
}

function noop(): void {}

function parseCaptureEvent(value: unknown): NativeCaptureEvent | null {
  if (value === null || typeof value !== "object") return null;
  const captureId = Reflect.get(value, "captureId");
  const type = Reflect.get(value, "type");
  if (typeof captureId !== "string" || (type !== "batch" && type !== "stopped")) return null;
  if (type === "stopped") return { captureId, type };
  const data = Reflect.get(value, "data");
  const level = Reflect.get(value, "level");
  const sampleRate = Reflect.get(value, "sampleRate");
  const numChannels = Reflect.get(value, "numChannels");
  const samplesPerChannel = Reflect.get(value, "samplesPerChannel");
  if (
    typeof data !== "string" ||
    (level !== undefined && (typeof level !== "number" || !Number.isFinite(level))) ||
    !Number.isInteger(sampleRate) ||
    !Number.isInteger(numChannels) ||
    !Number.isInteger(samplesPerChannel)
  )
    return null;
  return { captureId, data, level, numChannels, sampleRate, samplesPerChannel, type };
}
