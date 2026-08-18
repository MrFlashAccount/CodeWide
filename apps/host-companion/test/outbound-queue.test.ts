import { describe, expect, it } from "vitest";

import { BoundedOutboundQueue, type OutboundSocket } from "../src/outbound-queue.js";

class FakeSocket implements OutboundSocket {
  readyState = 1;
  readonly sent: string[] = [];
  readonly callbacks: Array<(error?: Error) => void> = [];

  send(payload: string, callback: (error?: Error) => void): void {
    this.sent.push(payload);
    this.callbacks.push(callback);
  }

  flush(error?: Error): void {
    this.callbacks.shift()?.(error);
  }
}

describe("BoundedOutboundQueue", () => {
  it("serializes a large frame and following control traffic without killing the socket", () => {
    const socket = new FakeSocket();
    const closes: Array<[number, string]> = [];
    const queue = new BoundedOutboundQueue({
      socket,
      openReadyState: 1,
      maxFrameBytes: 8 * 1024 * 1024,
      maxQueuedBytes: 8 * 1024 * 1024,
      close: (code, reason) => closes.push([code, reason]),
    });
    const activity = "a".repeat(5 * 1024 * 1024);

    expect(queue.send(activity)).toBe(true);
    expect(queue.send("dictation-response")).toBe(true);
    expect(socket.sent).toEqual([activity]);
    expect(closes).toEqual([]);

    socket.flush();
    expect(socket.sent).toEqual([activity, "dictation-response"]);
    socket.flush();
    expect(closes).toEqual([]);
  });

  it("fails closed only when the bounded application queue is actually exhausted", () => {
    const socket = new FakeSocket();
    const closes: Array<[number, string]> = [];
    const queue = new BoundedOutboundQueue({
      socket,
      openReadyState: 1,
      maxFrameBytes: 16,
      maxQueuedBytes: 20,
      close: (code, reason) => closes.push([code, reason]),
    });

    expect(queue.send("1234567890123456")).toBe(true);
    expect(queue.send("12345")).toBe(false);
    expect(closes).toEqual([[1013, "client_backpressure"]]);
  });
});
