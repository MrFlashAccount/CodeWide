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

function profile(connectionId: string, status: "stopped" | "connecting" | "live" | "unavailable", localPort: number | null, overrides: Record<string, unknown> = {}) {
  return {
    id: `forward-${connectionId}`,
    connectionId,
    label: "localhost:43191",
    remoteHost: "127.0.0.1" as const,
    remotePort: 43_191,
    preferredLocalPort: null,
    serviceKey: null,
    preference: "included" as const,
    localPort,
    enabled: status !== "stopped",
    status,
    previewUrl: localPort === null ? null : `http://127.0.0.1:${localPort}/`,
    error: null,
    updatedAt: 1,
    ...overrides,
  };
}

function discoveredPort(defaultForwardingEnabled: boolean) {
  return {
    port: 4_173,
    name: "Vite",
    group: "/workspace/app",
    details: "vite --port 4173",
    process: "node",
    pid: 101,
    cwd: "/workspace/app",
    kind: "vite" as const,
    forwardingKey: "a".repeat(64),
    defaultForwardingEnabled,
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

  it("automatically starts companion-recognized developer services", async () => {
    const connectionId = "automatic-server";
    const candidate = discoveredPort(true);
    native.list.mockResolvedValue([]);
    native.discover.mockResolvedValue({ ports: [candidate], scannedAt: Date.now() });
    native.upsert.mockImplementation(async (input: { profileId: string }) => profile(connectionId, "stopped", null, {
      id: input.profileId,
      label: candidate.name,
      remotePort: candidate.port,
      serviceKey: candidate.forwardingKey,
      preference: "automatic",
    }));
    native.start.mockImplementation(async (profileId: string) => profile(connectionId, "live", 46_212, {
      id: profileId,
      label: candidate.name,
      remotePort: candidate.port,
      serviceKey: candidate.forwardingKey,
      preference: "automatic",
    }));

    await nativePortForwardingStore.refreshDiscovery(connectionId);

    expect(native.upsert).toHaveBeenCalledWith(expect.objectContaining({
      serviceKey: candidate.forwardingKey,
      preference: "automatic",
      remotePort: candidate.port,
    }));
    expect(native.start).toHaveBeenCalledTimes(1);
  });

  it("leaves unknown ephemeral services available until explicitly included", async () => {
    const connectionId = "available-server";
    native.list.mockResolvedValue([]);
    native.discover.mockResolvedValue({ ports: [discoveredPort(false)], scannedAt: Date.now() });

    await nativePortForwardingStore.refreshDiscovery(connectionId);

    expect(native.upsert).not.toHaveBeenCalled();
    expect(native.start).not.toHaveBeenCalled();
  });

  it("does not overwrite an unavailable native event with a stale connecting result", async () => {
    const connectionId = "unavailable-server";
    native.list.mockResolvedValue([profile(connectionId, "stopped", null)]);
    await nativePortForwardingStore.scope(connectionId).load();
    native.start.mockImplementation(async () => {
      const connecting = profile(connectionId, "connecting", null);
      queueMicrotask(() => {
        for (const listener of native.listeners) listener({
          type: "profile",
          profile: profile(connectionId, "unavailable", 46_213, { previewUrl: null, error: "Nothing is listening on remote localhost:43191" }),
        });
      });
      return connecting;
    });

    const result = await nativePortForwardingStore.start(connectionId, `forward-${connectionId}`);

    expect(result.status).toBe("unavailable");
    expect(result.previewUrl).toBeNull();
  });
});
