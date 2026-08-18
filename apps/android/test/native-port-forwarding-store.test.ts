import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  listeners: [] as Array<(event: unknown) => void>,
  list: vi.fn(),
  upsert: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  remove: vi.fn(),
  discover: vi.fn(),
}));

vi.mock("../src/native/native-transport", () => ({
  subscribeNativePortForwards: (listener: (event: unknown) => void) => {
    native.listeners.push(listener);
    return () => {};
  },
  listNativePortForwards: native.list,
  upsertNativePortForward: native.upsert,
  startNativePortForward: native.start,
  stopNativePortForward: native.stop,
  removeNativePortForward: native.remove,
  discoverNativePorts: native.discover,
}));

import { nativePortForwardingStore } from "../src/data/native-port-forwarding-store";

function profile(connectionId: string, status: "stopped" | "connecting" | "live", localPort: number | null) {
  return {
    id: `forward-${connectionId}`,
    connectionId,
    label: "localhost:43191",
    remoteHost: "127.0.0.1" as const,
    remotePort: 43_191,
    preferredLocalPort: null,
    localPort,
    enabled: status !== "stopped",
    status,
    previewUrl: localPort === null ? null : `http://127.0.0.1:${localPort}/`,
    error: null,
    updatedAt: 1,
  };
}

describe("native port forwarding store", () => {
  beforeEach(() => {
    native.list.mockReset();
    native.upsert.mockReset();
    native.start.mockReset();
    native.stop.mockReset();
    native.remove.mockReset();
    native.discover.mockReset();
  });

  it("deduplicates simultaneous loopback link taps and waits for the native port", async () => {
    const connectionId = "dedupe-server";
    native.list.mockResolvedValue([]);
    native.upsert.mockResolvedValue(profile(connectionId, "stopped", null));
    native.start.mockImplementation(async () => {
      const connecting = profile(connectionId, "connecting", null);
      queueMicrotask(() => {
        for (const listener of native.listeners) listener({ type: "profile", profile: profile(connectionId, "live", 46_210) });
      });
      return connecting;
    });

    const input = { connectionId, remotePort: 43_191, label: "localhost:43191" };
    const [first, second] = await Promise.all([
      nativePortForwardingStore.ensureStarted(input),
      nativePortForwardingStore.ensureStarted(input),
    ]);

    expect(first.localPort).toBe(46_210);
    expect(second.localPort).toBe(46_210);
    expect(native.upsert).toHaveBeenCalledTimes(1);
    expect(native.start).toHaveBeenCalledTimes(1);
  });

  it("reuses an already live mapping", async () => {
    const connectionId = "live-server";
    native.list.mockResolvedValue([profile(connectionId, "live", 46_211)]);

    const result = await nativePortForwardingStore.ensureStarted({ connectionId, remotePort: 43_191, label: "localhost:43191" });

    expect(result.localPort).toBe(46_211);
    expect(native.upsert).not.toHaveBeenCalled();
    expect(native.start).not.toHaveBeenCalled();
  });
});
