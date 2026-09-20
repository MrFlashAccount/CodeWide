type RealtimePcmAudioChunk = {
  data: string;
  encoding?: "pcm_s16le";
  numChannels: number;
  sampleRate: number;
  samplesPerChannel: number;
};

type RealtimeOpusAudioChunk = {
  data: string;
  encoding: "opus";
  numChannels: number;
  sampleRate: number;
  samplesPerChannel: number;
};

export type RealtimeAudioChunk = RealtimePcmAudioChunk | RealtimeOpusAudioChunk;

type QueuedBatch = {
  byteLength: number;
  chunks: RealtimeAudioChunk[];
  id: number;
};

type RealtimeAudioFormat = {
  encoding: "pcm_s16le" | "opus";
  numChannels: number;
  sampleRate: number;
};

export type RealtimeAudioUploaderOptions = {
  batchDurationMs?: number;
  maxBufferedBytes?: number;
  onError: (message: string) => void;
  send: (batchId: number, chunks: RealtimeAudioChunk[], signal: AbortSignal) => Promise<void>;
};

const REALTIME_AUDIO_BATCH_DURATION_MS = 1000;
// WHY: Match the V2 four-batch ceiling so V1 cannot retain an entire Voice session during a stalled acknowledgement.
// oxlint-disable-next-line eslint/no-magic-numbers
const REALTIME_AUDIO_MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
// Base64 represents each three decoded bytes with exactly four encoded characters.
const BASE64_DECODED_BYTES_PER_QUANTUM = 3;
const BASE64_CHARACTERS_PER_QUANTUM = 4;

/**
 * Ordered bridge between native audio callbacks and the remote host.
 * Native callbacks are capture frames, not network packets: coalesce them into
 * one-second batches and keep exactly one RPC in flight so speech can never be
 * reordered by response timing. A short network stall is backpressure, not data
 * loss; the bounded buffer fails the recording instead of retaining audio
 * indefinitely when the host cannot acknowledge it.
 */
export class RealtimeAudioUploader {
  readonly #send: RealtimeAudioUploaderOptions["send"];
  readonly #onError: RealtimeAudioUploaderOptions["onError"];
  readonly #batchDurationMs: number;
  readonly #maxBufferedBytes: number;
  readonly #queue: QueuedBatch[] = [];
  readonly #drainWaiters = new Set<() => void>();
  readonly #abortController = new AbortController();
  #pendingChunks: RealtimeAudioChunk[] = [];
  #pendingBytes = 0;
  #pendingDurationMs = 0;
  #bufferedBytes = 0;
  #inFlight: Promise<void> | null = null;
  #nextBatchId = 0;
  #accepting = true;
  #failed = false;
  #cancelled = false;
  #format: RealtimeAudioFormat | null = null;

  constructor(options: RealtimeAudioUploaderOptions) {
    this.#send = options.send;
    this.#onError = options.onError;
    this.#batchDurationMs = positiveInteger(
      options.batchDurationMs ?? REALTIME_AUDIO_BATCH_DURATION_MS,
      "batchDurationMs",
    );
    this.#maxBufferedBytes = positiveInteger(
      options.maxBufferedBytes ?? REALTIME_AUDIO_MAX_BUFFERED_BYTES,
      "maxBufferedBytes",
    );
  }

  append(chunk: RealtimeAudioChunk): void {
    if (!this.#accepting || this.#failed) {
      return;
    }
    const durationMs = chunkDurationMs(chunk);
    if (durationMs === null) {
      this.#fail("Invalid microphone audio chunk");
      return;
    }
    const encoding = chunk.encoding ?? "pcm_s16le";
    if (this.#format === null) {
      this.#format = { encoding, numChannels: chunk.numChannels, sampleRate: chunk.sampleRate };
    } else if (
      this.#format.encoding !== encoding ||
      this.#format.sampleRate !== chunk.sampleRate ||
      this.#format.numChannels !== chunk.numChannels
    ) {
      this.#fail("Microphone audio format changed during recording");
      return;
    }
    const byteLength = decodedBase64ByteLength(chunk.data);
    if (this.#bufferedBytes + byteLength > this.#maxBufferedBytes) {
      this.#fail("Voice audio buffer capacity exceeded");
      return;
    }
    this.#appendPending(chunk, durationMs, byteLength);
  }

  async finish(): Promise<void> {
    this.#accepting = false;
    if (this.#failed || this.#format === null) {
      return;
    }
    this.#flushPending();
    await this.#waitForDrain();
  }

  async cancel(): Promise<void> {
    this.#accepting = false;
    this.#cancelled = true;
    this.#abortController.abort();
    this.#discardPending();
    this.#discardQueued();
    await this.#waitForDrain();
  }

  #appendPending(chunk: RealtimeAudioChunk, durationMs: number, byteLength: number): void {
    this.#pendingChunks.push(chunk);
    this.#pendingBytes += byteLength;
    this.#pendingDurationMs += durationMs;
    this.#bufferedBytes += byteLength;
    if (this.#pendingDurationMs >= this.#batchDurationMs) {
      this.#flushPending();
    }
  }

  #flushPending(): void {
    if (this.#pendingChunks.length === 0) {
      return;
    }
    this.#queue.push({
      byteLength: this.#pendingBytes,
      chunks: this.#pendingChunks,
      id: this.#nextBatchId,
    });
    this.#nextBatchId += 1;
    this.#pendingChunks = [];
    this.#pendingBytes = 0;
    this.#pendingDurationMs = 0;
    this.#pump();
  }

  #pump(): void {
    if (this.#failed || this.#cancelled || this.#inFlight !== null) {
      return;
    }
    const entry = this.#queue.shift();
    if (entry !== undefined) {
      const request = this.#send(entry.id, entry.chunks, this.#abortController.signal)
        .catch((error: unknown) => {
          if (this.#cancelled) {
            return;
          }
          this.#fail(error instanceof Error ? error.message : "Audio upload failed");
        })
        .finally(() => {
          this.#bufferedBytes -= entry.byteLength;
          if (this.#inFlight === request) {
            this.#inFlight = null;
          }
          this.#pump();
          this.#resolveDrainIfIdle();
        });
      this.#inFlight = request;
    }
    this.#resolveDrainIfIdle();
  }

  #fail(message: string): void {
    if (this.#failed) {
      return;
    }
    this.#failed = true;
    this.#accepting = false;
    this.#abortController.abort();
    this.#discardPending();
    this.#discardQueued();
    this.#onError(message);
    this.#resolveDrainIfIdle();
  }

  #discardQueued(): void {
    for (const entry of this.#queue) {
      this.#bufferedBytes -= entry.byteLength;
    }
    this.#queue.length = 0;
    this.#resolveDrainIfIdle();
  }

  #discardPending(): void {
    this.#bufferedBytes -= this.#pendingBytes;
    this.#pendingChunks = [];
    this.#pendingBytes = 0;
    this.#pendingDurationMs = 0;
  }

  async #waitForDrain(): Promise<void> {
    if (this.#queue.length === 0 && this.#inFlight === null) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.#drainWaiters.add(resolve);
    });
  }

  #resolveDrainIfIdle(): void {
    if (this.#queue.length !== 0 || this.#inFlight !== null) {
      return;
    }
    for (const resolve of this.#drainWaiters) {
      resolve();
    }
    this.#drainWaiters.clear();
  }
}

function chunkDurationMs(chunk: RealtimeAudioChunk): number | null {
  if (
    chunk.data.length === 0 ||
    !Number.isSafeInteger(chunk.sampleRate) ||
    chunk.sampleRate <= 0 ||
    !Number.isSafeInteger(chunk.numChannels) ||
    chunk.numChannels <= 0 ||
    !Number.isSafeInteger(chunk.samplesPerChannel) ||
    chunk.samplesPerChannel <= 0
  ) {
    return null;
  }
  return (chunk.samplesPerChannel * 1000) / chunk.sampleRate;
}

function decodedBase64ByteLength(value: string): number {
  const padding = value.endsWith("==") ? "==".length : value.endsWith("=") ? "=".length : "".length;
  return Math.max(
    "".length,
    Math.floor((value.length * BASE64_DECODED_BYTES_PER_QUANTUM) / BASE64_CHARACTERS_PER_QUANTUM) -
      padding,
  );
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
