import { RpcResponseError, type RpcClient } from "@codewide/sync-client";
import type { CapturedAudioChunk } from "../native/native-transport";
import { incrementMetric, recordTiming } from "./operational-metrics";
import { RealtimeAudioUploader } from "./realtime-audio-uploader";
import {
  RetryableVoiceTranscriptionError,
  UnretryableVoiceTranscriptionError,
  type VoiceTranscriptionEvent,
  type VoiceTranscriptionOptions,
  type VoiceTranscriptionSession,
} from "./voice-input-controller";

export type VoiceAudioChunk = CapturedAudioChunk;
export type VoiceTranscriptionListener = (event: VoiceTranscriptionEvent) => void;

/** Qualified authenticated session access; transport never owns the workspace lifecycle. */
export type VoiceTransportAuthority = {
  getEnabledSession: (connectionId: string) => RpcClient | undefined;
  rpcAfterAttach: (session: RpcClient, method: string, params: unknown) => Promise<unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

/** Retains the existing dictation session, acknowledgement and cancellation policy. */
export function createVoiceTransport({
  getEnabledSession,
  rpcAfterAttach,
}: VoiceTransportAuthority) {
  const startVoiceTranscription = async (
    connectionId: string,
    _threadId: string,
    listener: VoiceTranscriptionListener,
    options: VoiceTranscriptionOptions = {},
  ): Promise<VoiceTranscriptionSession> => {
    const session = getEnabledSession(connectionId);
    if (session === undefined) {
      throw new Error("Connection is not enabled");
    }
    const voiceStartAt = performance.now();
    let start: unknown;
    try {
      start = await rpcAfterAttach(session, "companion/dictation/start", {
        ...(options.language === undefined ? {} : { language: options.language }),
        ...(options.capture === undefined
          ? {}
          : {
              automaticGainControl: options.capture.automaticGainControl,
              captureSource: options.capture.source,
              noiseSuppressor: options.capture.noiseSuppressor,
            }),
      });
      recordTiming("voice_start_ms", performance.now() - voiceStartAt);
    } catch (error) {
      incrementMetric("voice_failures");
      throw error;
    }
    const sessionId = asRecord(start)?.sessionId;
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      incrementMetric("voice_failures");
      throw new Error("Companion returned an invalid dictation session");
    }
    let acceptingAudio = true;
    let disposed = false;
    const cancellation = new AbortController();
    let audioDrained = false;
    let finishInFlight: Promise<void> | null = null;
    let uploadError: string | null = null;
    const uploader = new RealtimeAudioUploader({
      onError: (message) => {
        uploadError = message;
        incrementMetric("voice_failures");
        if (!disposed) {
          listener({ message, type: "error" });
        }
      },
      send: async (batchId, chunks, signal) => {
        await sendDictationBatchUntilAccepted(
          session,
          {
            batchId: String(batchId),
            chunks,
            sessionId,
          },
          signal,
        );
      },
    });

    const append = (chunk: VoiceAudioChunk) => {
      if (!acceptingAudio || disposed) {
        return;
      }
      uploader.append(chunk);
    };
    const close = async (flush: boolean) => {
      if (disposed) {
        return;
      }
      if (!flush) {
        acceptingAudio = false;
        disposed = true;
        cancellation.abort();
        await Promise.all([
          uploader.cancel(),
          rpcAfterAttach(session, "companion/dictation/cancel", { sessionId }),
        ]);
        return;
      }
      acceptingAudio = false;
      if (finishInFlight !== null) {
        await finishInFlight;
        return;
      }
      const finishing = (async () => {
        if (!audioDrained) {
          const voiceDrainAt = performance.now();
          await raceAudioUploadAbort(uploader.finish(), cancellation.signal);
          audioDrained = true;
          recordTiming("voice_drain_ms", performance.now() - voiceDrainAt);
        }
        throwIfAudioUploadAborted(cancellation.signal);
        if (uploadError !== null) {
          await rpcAfterAttach(session, "companion/dictation/cancel", { sessionId }).catch(
            () => undefined,
          );
          disposed = true;
          throw new UnretryableVoiceTranscriptionError(uploadError);
        }
        const voiceFinishAt = performance.now();
        const response = asRecord(
          await finishDictationWithTransportRetry(session, sessionId, cancellation.signal),
        );
        throwIfAudioUploadAborted(cancellation.signal);
        recordTiming("voice_finish_ms", performance.now() - voiceFinishAt);
        if (response?.retryable === true) {
          const retryAfterMs =
            typeof response.retryAfterMs === "number" && Number.isFinite(response.retryAfterMs)
              ? Math.max(0, response.retryAfterMs)
              : 1000;
          throw new RetryableVoiceTranscriptionError(
            typeof response.message === "string"
              ? response.message
              : "OpenAI transcription can be retried",
            retryAfterMs,
          );
        }
        const text = response?.text;
        if (typeof text !== "string") {
          throw new Error("Companion returned an invalid transcript");
        }
        disposed = true;
        listener({ text, type: "done" });
      })();
      finishInFlight = finishing;
      try {
        await finishing;
      } finally {
        if (finishInFlight === finishing) {
          finishInFlight = null;
        }
      }
    };
    return {
      appendAudio: append,
      cancel: async () => {
        await close(false);
      },
      finish: async () => {
        await close(true);
      },
    };
  };

  const AUDIO_UPLOAD_RETRY_BASE_MS = 250;
  const AUDIO_UPLOAD_RETRY_MAX_MS = 5000;
  const DICTATION_FINISH_TRANSPORT_RETRIES = 3;

  async function finishDictationWithTransportRetry(
    session: RpcClient,
    sessionId: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    for (let attempt = 0; ; attempt += 1) {
      throwIfAudioUploadAborted(signal);
      try {
        if (session.waitUntilLive !== undefined) {
          await raceAudioUploadAbort(session.waitUntilLive(30_000), signal);
        }
        throwIfAudioUploadAborted(signal);
        return await raceAudioUploadAbort(
          rpcAfterAttach(session, "companion/dictation/finish", { sessionId }),
          signal,
        );
      } catch (error) {
        throwIfAudioUploadAborted(signal);
        const transientRpc =
          error instanceof RpcResponseError && (error.code === -32_003 || error.code === -32_004);
        if (
          (error instanceof RpcResponseError && !transientRpc) ||
          attempt >= DICTATION_FINISH_TRANSPORT_RETRIES
        ) {
          throw error;
        }
        await waitForAudioUploadRetry(
          Math.min(2000, AUDIO_UPLOAD_RETRY_BASE_MS * 2 ** attempt),
          signal,
        );
      }
    }
  }

  async function sendDictationBatchUntilAccepted(
    session: RpcClient,
    params: unknown,
    signal: AbortSignal,
  ): Promise<void> {
    let attempt = 0;
    for (;;) {
      throwIfAudioUploadAborted(signal);
      try {
        if (session.waitUntilLive !== undefined) {
          await raceAudioUploadAbort(session.waitUntilLive(30_000), signal);
        }
        await raceAudioUploadAbort(
          rpcAfterAttach(session, "companion/dictation/appendBatch", params),
          signal,
        );
        return;
      } catch (error) {
        throwIfAudioUploadAborted(signal);
        // Companion validation/auth failures are deterministic. Transport loss,
        // reconnect windows and host backpressure are not: keep the same
        // idempotent batch queued and retry until the host acknowledges it.
        if (error instanceof RpcResponseError && error.code !== -32_003 && error.code !== -32_004) {
          throw error;
        }
        const delayMs = Math.min(
          AUDIO_UPLOAD_RETRY_MAX_MS,
          AUDIO_UPLOAD_RETRY_BASE_MS * 2 ** Math.min(attempt, 5),
        );
        attempt += 1;
        await waitForAudioUploadRetry(delayMs, signal);
      }
    }
  }

  function throwIfAudioUploadAborted(signal: AbortSignal): void {
    if (!signal.aborted) {
      return;
    }
    const error = new Error("Audio upload cancelled");
    error.name = "AbortError";
    throw error;
  }

  async function raceAudioUploadAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
    throwIfAudioUploadAborted(signal);
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        signal.removeEventListener("abort", abort);
        const error = new Error("Audio upload cancelled");
        error.name = "AbortError";
        reject(error);
      };
      signal.addEventListener("abort", abort, { once: true });
      operation.then(
        (value) => {
          signal.removeEventListener("abort", abort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", abort);
          reject(error instanceof Error ? error : new Error("Audio upload failed"));
        },
      );
    });
  }

  async function waitForAudioUploadRetry(delayMs: number, signal: AbortSignal): Promise<void> {
    await raceAudioUploadAbort(
      new Promise<void>((resolve) => {
        setTimeout(resolve, delayMs);
      }),
      signal,
    );
  }

  return startVoiceTranscription;
}
