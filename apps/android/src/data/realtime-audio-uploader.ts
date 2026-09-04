type RealtimePcmAudioChunk = {
  encoding?: "pcm_s16le";
  data: string;
  sampleRate: number;
  numChannels: number;
  samplesPerChannel: number;
};

type RealtimeOpusAudioChunk = {
  encoding: "opus";
  data: string;
  sampleRate: number;
  numChannels: number;
  samplesPerChannel: number;
};

export type RealtimeAudioChunk = RealtimePcmAudioChunk | RealtimeOpusAudioChunk;

type QueuedBatch = {
  id: number;
  chunks: RealtimeAudioChunk[];
};

type RealtimeAudioFormat = {
  encoding: "pcm_s16le" | "opus";
  sampleRate: number;
  numChannels: number;
};

export type RealtimeAudioUploaderOptions = {
  send(batchId: number, chunks: RealtimeAudioChunk[], signal: AbortSignal): Promise<void>;
  onError(message: string): void;
  batchDurationMs?: number;
};

export const REALTIME_AUDIO_BATCH_DURATION_MS = 1_000;

/**
 * Ordered bridge between native audio callbacks and the remote host.
 * Native callbacks are capture frames, not network packets: coalesce them into
 * one-second batches and keep exactly one RPC in flight so speech can never be
 * reordered by response timing. Network slowness is backpressure, not data
 * loss: queued microphone audio remains pending until accepted or cancelled.
 */
export class RealtimeAudioUploader {
  readonly #send: RealtimeAudioUploaderOptions["send"];
  readonly #onError: RealtimeAudioUploaderOptions["onError"];
  readonly #batchDurationMs: number;
  readonly #queue: QueuedBatch[] = [];
  readonly #drainWaiters = new Set<() => void>();
  readonly #abortController = new AbortController();
  #pendingChunks: RealtimeAudioChunk[] = [];
  #pendingDurationMs = 0;
  #inFlight: Promise<void> | null = null;
  #nextBatchId = 0;
  #accepting = true;
  #failed = false;
  #cancelled = false;
  #format: RealtimeAudioFormat | null = null;

  constructor(options: RealtimeAudioUploaderOptions) {
    this.#send = options.send;
    this.#onError = options.onError;
    this.#batchDurationMs = positiveInteger(options.batchDurationMs ?? REALTIME_AUDIO_BATCH_DURATION_MS, "batchDurationMs");
  }

  append(chunk: RealtimeAudioChunk): void {
    if (!this.#accepting || this.#failed) return;
    const durationMs = chunkDurationMs(chunk);
    if (durationMs === null) {
      this.#fail("Invalid microphone audio chunk");
      return;
    }
    const encoding = chunk.encoding ?? "pcm_s16le";
    if (this.#format === null) {
      this.#format = { encoding, sampleRate: chunk.sampleRate, numChannels: chunk.numChannels };
    } else if (
      this.#format.encoding !== encoding
      || this.#format.sampleRate !== chunk.sampleRate
      || this.#format.numChannels !== chunk.numChannels
    ) {
      this.#fail("Microphone audio format changed during recording");
      return;
    }
    this.#appendPending(chunk, durationMs);
  }

  async finish(): Promise<void> {
    this.#accepting = false;
    if (this.#failed || this.#format === null) return;
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

  #appendPending(chunk: RealtimeAudioChunk, durationMs: number): void {
    this.#pendingChunks.push(chunk);
    this.#pendingDurationMs += durationMs;
    if (this.#pendingDurationMs >= this.#batchDurationMs) this.#flushPending();
  }

  #flushPending(): void {
    if (this.#pendingChunks.length === 0) return;
    this.#queue.push({ id: this.#nextBatchId, chunks: this.#pendingChunks });
    this.#nextBatchId += 1;
    this.#pendingChunks = [];
    this.#pendingDurationMs = 0;
    this.#pump();
  }

  #pump(): void {
    if (this.#failed || this.#cancelled || this.#inFlight !== null) return;
    const entry = this.#queue.shift();
    if (entry !== undefined) {
      const request = this.#send(entry.id, entry.chunks, this.#abortController.signal)
        .catch((cause: unknown) => {
          if (this.#cancelled) return;
          this.#fail(cause instanceof Error ? cause.message : "Audio upload failed");
        })
        .finally(() => {
          if (this.#inFlight === request) this.#inFlight = null;
          this.#pump();
          this.#resolveDrainIfIdle();
        });
      this.#inFlight = request;
    }
    this.#resolveDrainIfIdle();
  }

  #fail(message: string): void {
    if (this.#failed) return;
    this.#failed = true;
    this.#accepting = false;
    this.#abortController.abort();
    this.#discardPending();
    this.#discardQueued();
    this.#onError(message);
    this.#resolveDrainIfIdle();
  }

  #discardQueued(): void {
    this.#queue.length = 0;
    this.#resolveDrainIfIdle();
  }

  #discardPending(): void {
    this.#pendingChunks = [];
    this.#pendingDurationMs = 0;
  }

  async #waitForDrain(): Promise<void> {
    if (this.#queue.length === 0 && this.#inFlight === null) return;
    await new Promise<void>((resolve) => this.#drainWaiters.add(resolve));
  }

  #resolveDrainIfIdle(): void {
    if (this.#queue.length !== 0 || this.#inFlight !== null) return;
    for (const resolve of this.#drainWaiters) resolve();
    this.#drainWaiters.clear();
  }
}

function chunkDurationMs(chunk: RealtimeAudioChunk): number | null {
  if (
    chunk.data.length === 0 ||
    !Number.isSafeInteger(chunk.sampleRate) || chunk.sampleRate <= 0 ||
    !Number.isSafeInteger(chunk.numChannels) || chunk.numChannels <= 0 ||
    !Number.isSafeInteger(chunk.samplesPerChannel) || chunk.samplesPerChannel <= 0
  ) return null;
  return chunk.samplesPerChannel * 1_000 / chunk.sampleRate;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}
