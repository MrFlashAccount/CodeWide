import { V2_PROTOCOL_LIMITS, type V2VoiceClientRecord } from "@codewide/sync-client/v2";

type VoiceBatchRecord = Extract<V2VoiceClientRecord, { type: "batch" }>;

interface BufferedVoiceBatch {
  byteLength: number;
  record: VoiceBatchRecord;
}

interface VoiceBatchFlowSender {
  sendBatch(record: VoiceBatchRecord): void;
  sendFinish(): void;
}

// Four maximum-size batches tolerate a short ACK stall without retaining an
// entire 192 MiB Voice session in the JavaScript heap.
const VOICE_BUFFER_MAX_BYTES = Math.min(
  V2_PROTOCOL_LIMITS.voiceSessionMaxBytes,
  V2_PROTOCOL_LIMITS.voiceBatchMaxBytes * 4,
);

/**
 * Preserves microphone order across the Voice protocol's single-unacked-batch
 * window and sends finish only after every captured batch is acknowledged.
 */
export class VoiceBatchFlow {
  readonly #sender: VoiceBatchFlowSender;
  readonly #queued: BufferedVoiceBatch[] = [];
  #inFlight: BufferedVoiceBatch | null = null;
  #bufferedBytes = 0;
  #finishRequested = false;
  #finishSent = false;
  #closed = false;
  #resolveFinish: (() => void) | null = null;
  #finishPromise: Promise<void> | null = null;

  constructor(sender: VoiceBatchFlowSender) {
    this.#sender = sender;
  }

  append(record: VoiceBatchRecord): void {
    if (this.#closed || this.#finishRequested || this.#finishSent)
      throw new Error("Voice capture is already sealed");
    const byteLength = decodedBase64ByteLength(record.data);
    if (this.#bufferedBytes + byteLength > VOICE_BUFFER_MAX_BYTES)
      throw new Error("Voice audio buffer capacity exceeded");
    this.#bufferedBytes += byteLength;
    this.#queued.push({ byteLength, record });
    this.#pump();
  }

  acknowledge(sessionId: string, sequence: string): boolean {
    const inFlight = this.#inFlight;
    if (
      this.#closed ||
      inFlight === null ||
      inFlight.record.sessionId !== sessionId ||
      inFlight.record.sequence !== sequence
    )
      return false;
    this.#bufferedBytes -= inFlight.byteLength;
    this.#inFlight = null;
    this.#pump();
    return true;
  }

  finish(): Promise<void> {
    if (this.#closed) return Promise.reject(new Error("Voice session is closed"));
    if (this.#finishSent) return Promise.resolve();
    if (this.#finishPromise !== null) return this.#finishPromise;
    this.#finishRequested = true;
    const finishing = new Promise<void>((resolve) => {
      this.#resolveFinish = resolve;
    });
    this.#finishPromise = finishing;
    this.#pump();
    return finishing;
  }

  allowFinishRetry(): void {
    if (this.#closed) return;
    this.#finishSent = false;
    this.#finishPromise = null;
    this.#resolveFinish = null;
  }

  close(): void {
    this.#closed = true;
    this.#queued.length = 0;
    this.#inFlight = null;
    this.#bufferedBytes = 0;
    this.#finishRequested = false;
    this.#resolveFinish?.();
    this.#resolveFinish = null;
    this.#finishPromise = null;
  }

  #pump(): void {
    if (this.#closed || this.#inFlight !== null) return;
    const next = this.#queued.shift();
    if (next !== undefined) {
      this.#inFlight = next;
      this.#sender.sendBatch(next.record);
      return;
    }
    if (!this.#finishRequested || this.#finishSent) return;
    this.#finishRequested = false;
    this.#finishSent = true;
    this.#sender.sendFinish();
    this.#resolveFinish?.();
    this.#resolveFinish = null;
    this.#finishPromise = null;
  }
}

function decodedBase64ByteLength(value: string): number {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}
