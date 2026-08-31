import { NativeEventEmitter, NativeModules } from "react-native";
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
import { acquireSharedConnectionLease } from "../connection/sharedConnectionAdapter.native";

type NativeVoiceCapture = {
  start(captureId: string): Promise<{ numChannels: number; sampleRate: number }>;
  stop(): void;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
};

type NativeCaptureEvent = {
  captureId: string;
  data?: string;
  numChannels?: number;
  sampleRate?: number;
  samplesPerChannel?: number;
  type: "batch" | "stopped";
};

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
      const connection = await acquireSharedConnectionLease(input.audience);
      const channel = connection.lease.openDuplex("voice-v2");
      const id = captureId();
      let sessionId: string | null = null;
      let sequence = 0;
      let captureActive = false;
      let settled = false;
      let handleResolved = false;
      let releaseCaptureListener: (() => void) | null = null;

      const finish = async (): Promise<void> => {
        if (settled) return;
        settled = true;
        captureActive = false;
        capture.stop();
        releaseCaptureListener?.();
        releaseCaptureListener = null;
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
        const send = (record: V2VoiceClientRecord): void => {
          if (settled || channel.readyState !== 1)
            throw new Error("Voice transport is unavailable");
          channel.send(JSON.stringify(validateV2VoiceClientRecord(record)));
        };
        const stopCapture = (): void => {
          captureActive = false;
          capture.stop();
          releaseCaptureListener?.();
          releaseCaptureListener = null;
        };
        const onCapture = (raw: unknown): void => {
          const event = parseCaptureEvent(raw);
          if (event === null || event.captureId !== id || !captureActive || sessionId === null)
            return;
          if (event.type === "stopped") {
            captureActive = false;
            return;
          }
          const { data, numChannels, sampleRate, samplesPerChannel } = event;
          if (
            data === undefined ||
            numChannels === undefined ||
            sampleRate === undefined ||
            samplesPerChannel === undefined
          )
            return;
          try {
            send({
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
              const subscription = events.addListener(EVENT, onCapture);
              releaseCaptureListener = () => subscription.remove();
              capture
                .start(id)
                .then(() => {
                  captureActive = true;
                  report({ type: "recording" });
                  handleResolved = true;
                  resolve({
                    async cancel() {
                      if (sessionId === null || settled) return;
                      stopCapture();
                      try {
                        send({ sessionId, type: "cancel" });
                      } catch {
                        report({ type: "error" });
                        await finish();
                      }
                    },
                    async finish() {
                      if (sessionId === null || settled) return;
                      stopCapture();
                      try {
                        send({ sessionId, type: "finish" });
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
            if (record.type === "ack") return;
            if (record.type === "retry") {
              report({ retryAfterMs: record.retryAfterMs, type: "retry" });
              return;
            }
            if (record.type === "result") {
              stopCapture();
              report({ text: record.text, type: "result" });
              void finish().catch(() => undefined);
              return;
            }
            if (record.type === "cancelled") {
              stopCapture();
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

function parseCaptureEvent(value: unknown): NativeCaptureEvent | null {
  if (value === null || typeof value !== "object") return null;
  const captureId = Reflect.get(value, "captureId");
  const type = Reflect.get(value, "type");
  if (typeof captureId !== "string" || (type !== "batch" && type !== "stopped")) return null;
  if (type === "stopped") return { captureId, type };
  const data = Reflect.get(value, "data");
  const sampleRate = Reflect.get(value, "sampleRate");
  const numChannels = Reflect.get(value, "numChannels");
  const samplesPerChannel = Reflect.get(value, "samplesPerChannel");
  if (
    typeof data !== "string" ||
    !Number.isInteger(sampleRate) ||
    !Number.isInteger(numChannels) ||
    !Number.isInteger(samplesPerChannel)
  )
    return null;
  return { captureId, data, numChannels, sampleRate, samplesPerChannel, type };
}
