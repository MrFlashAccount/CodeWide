export type OutboundSocket = {
  readonly readyState: number;
  send(payload: string, callback: (error?: Error) => void): void;
};

export type BoundedOutboundQueueOptions = {
  socket: OutboundSocket;
  openReadyState: number;
  maxFrameBytes: number;
  maxQueuedBytes: number;
  close(code: number, reason: string): void;
  onLimit?(diagnostic: { reason: string; frameBytes: number; queuedBytes: number }): void;
};

type OutboundFrame = { payload: string; bytes: number };

/**
 * Applies real WebSocket backpressure instead of treating `bufferedAmount` as
 * an error. Only one frame is handed to the socket at a time; the send callback
 * advances the bounded queue after that frame has left ws' own buffer.
 */
export class BoundedOutboundQueue {
  readonly #options: BoundedOutboundQueueOptions;
  readonly #frames: OutboundFrame[] = [];
  #queuedBytes = 0;
  #sending = false;
  #disposed = false;

  constructor(options: BoundedOutboundQueueOptions) {
    this.#options = options;
  }

  send(payload: string): boolean {
    if (this.#disposed || this.#options.socket.readyState !== this.#options.openReadyState) return false;
    const bytes = Buffer.byteLength(payload);
    if (bytes > this.#options.maxFrameBytes) {
      this.#reject("outbound_frame_too_large", 1009, bytes);
      return false;
    }
    if (this.#queuedBytes + bytes > this.#options.maxQueuedBytes) {
      this.#reject("client_backpressure", 1013, bytes);
      return false;
    }
    this.#frames.push({ payload, bytes });
    this.#queuedBytes += bytes;
    this.#pump();
    return true;
  }

  dispose(): void {
    this.#disposed = true;
    this.#frames.length = 0;
    this.#queuedBytes = 0;
  }

  #pump(): void {
    if (this.#disposed || this.#sending || this.#options.socket.readyState !== this.#options.openReadyState) return;
    const frame = this.#frames.shift();
    if (frame === undefined) return;
    this.#sending = true;
    try {
      this.#options.socket.send(frame.payload, (error) => {
        this.#sending = false;
        this.#queuedBytes = Math.max(0, this.#queuedBytes - frame.bytes);
        if (this.#disposed) return;
        // ws follows Node callback conventions and may report success as null
        // even though its TypeScript declaration only mentions undefined.
        if (error != null) {
          this.#options.close(1011, "client_send_failed");
          this.dispose();
          return;
        }
        this.#pump();
      });
    } catch {
      this.#sending = false;
      this.#queuedBytes = Math.max(0, this.#queuedBytes - frame.bytes);
      this.#options.close(1011, "client_send_failed");
      this.dispose();
    }
  }

  #reject(reason: string, code: number, frameBytes: number): void {
    this.#options.onLimit?.({ reason, frameBytes, queuedBytes: this.#queuedBytes });
    this.#options.close(code, reason);
    this.dispose();
  }
}
