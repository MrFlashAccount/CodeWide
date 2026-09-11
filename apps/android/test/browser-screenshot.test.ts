import { afterEach, describe, expect, it, vi } from "vitest";
import { captureBrowserScreenshot } from "../src/browser/capture-screenshot";

class Socket {
  static readonly CLOSING = 2;
  static latest: Socket | null = null;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  readonly requests: string[] = [];
  constructor() { Socket.latest = this; }
  send(message: string) { this.requests.push(message); }
  close() { this.readyState = 3; this.onclose?.(); }
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); Socket.latest = null; });

describe("browser screenshot CDP adapter", () => {
  it("captures only the viewport and closes its connection after the correlated response", async () => {
    vi.stubGlobal("WebSocket", Socket);
    const result = captureBrowserScreenshot("ws://127.0.0.1/test");
    const socket = Socket.latest;
    if (socket === null) throw new Error("Missing socket");
    socket.onopen?.();
    expect(JSON.parse(socket.requests[0] ?? "null")).toMatchObject({ method: "Page.captureScreenshot", params: { captureBeyondViewport: false } });
    socket.onmessage?.({ data: JSON.stringify({ id: 1, result: { data: "aW1hZ2U=" } }) });
    await expect(result).resolves.toBe("aW1hZ2U=");
    expect(socket.readyState).toBe(3);
  });
  it("times out instead of leaving the browser capture pending indefinitely", async () => {
    vi.useFakeTimers(); vi.stubGlobal("WebSocket", Socket);
    const result = captureBrowserScreenshot("ws://127.0.0.1/test");
    const failure = expect(result).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(5000);
    await failure;
    expect(Socket.latest?.readyState).toBe(3);
  });
});
