import { afterEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({
  listeners: new Set<(raw: unknown) => void>(),
  listPortForwards: vi.fn(),
  startPortForward: vi.fn(),
}));

// WHY: Node cannot load React Native's native module registry or event emitter.
// Only that platform boundary is replaced; projection validation runs unchanged.
vi.mock("react-native", () => ({
  NativeModules: { CodeWideNative: platform },
  NativeEventEmitter: class {
    addListener(_name: string, listener: (raw: unknown) => void) {
      platform.listeners.add(listener);
      return { remove: () => platform.listeners.delete(listener) };
    }
  },
  Platform: { OS: "android" },
  PermissionsAndroid: {},
}));

import {
  listNativePortForwards,
  parseNativePortForwardProfile,
  startNativePortForward,
  subscribeNativePortForwards,
} from "../src/native/native-transport.native";
import { savedServerId } from "../src/v2/domain/ids";
import { createClosedPortTransport } from "../src/v2/infrastructure/ports/closedPortTransport.native";

function liveProfile(previewUrl = "http://127.0.0.1:46210/") {
  return {
    id: "forward-test",
    connectionId: "server-test",
    label: "Development server",
    remoteHost: "127.0.0.1",
    remotePort: 9119,
    preferredLocalPort: null,
    serviceKey: null,
    preference: "included",
    localPort: 46210,
    enabled: true,
    status: "live",
    previewUrl,
    error: null,
    updatedAt: 1,
  };
}

afterEach(() => {
  platform.listeners.clear();
  vi.clearAllMocks();
});

describe("native port-forward projections", () => {
  it("accepts the raw loopback URL returned by native-136", () => {
    const profile = liveProfile();
    expect(parseNativePortForwardProfile(profile)).toEqual(profile);
  });

  it("retains compatibility with older native shells' capability URLs", () => {
    const profile = liveProfile(`http://127.0.0.1:46210/${"a".repeat(43)}/`);
    expect(parseNativePortForwardProfile(profile)).toEqual(profile);
  });

  it("delivers the connecting-to-live transition instead of dropping the live event", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeNativePortForwards(listener);
    const live = liveProfile();
    const connecting = { ...live, status: "connecting", localPort: null, previewUrl: null };
    for (const profile of [connecting, live]) {
      for (const receive of platform.listeners) receive(JSON.stringify({ type: "profile", profile }));
    }
    expect(listener.mock.calls.map(([event]) => event.profile.status)).toEqual(["connecting", "live"]);
    expect(listener).toHaveBeenLastCalledWith({ type: "profile", profile: live });
    unsubscribe();
    expect(platform.listeners.size).toBe(0);
  });

  it("accepts live profiles from both list and start bridge responses", async () => {
    const profile = liveProfile();
    platform.listPortForwards.mockResolvedValue(JSON.stringify([profile]));
    platform.startPortForward.mockResolvedValue(JSON.stringify(profile));
    expect(await listNativePortForwards(profile.connectionId)).toEqual([profile]);
    expect(await startNativePortForward(profile.id)).toEqual(profile);
  });

  it.each(["http://127.0.0.1:46210/", `http://127.0.0.1:46210/${"a".repeat(43)}/`])(
    "accepts the native URL in V2 list, start and live events: %s", async (url) => {
      const transport = createClosedPortTransport();
      const profile = liveProfile(url);
      const id = savedServerId(profile.connectionId);
      platform.listPortForwards.mockResolvedValue(JSON.stringify([profile]));
      platform.startPortForward.mockResolvedValue(JSON.stringify(profile));
      expect(await transport.list(id)).toEqual([expect.objectContaining({ status: "live", previewUrl: url })]);
      expect(await transport.start(id, profile.id)).toEqual(expect.objectContaining({ status: "live", previewUrl: url }));
      const listener = vi.fn();
      const unsubscribe = transport.subscribe(listener);
      for (const incoming of [{ ...profile, status: "connecting", localPort: null, previewUrl: null }, profile]) {
        for (const receive of platform.listeners) receive(JSON.stringify({ type: "profile", profile: incoming }));
      }
      expect(listener.mock.calls.map(([event]) => event.profile.status)).toEqual(["connecting", "live"]);
      unsubscribe();
    },
  );

  it.each([
    "https://127.0.0.1:46210/",
    "http://localhost:46210/",
    "http://example.test:46210/",
    "http://127.0.0.1.example.test:46210/",
    "http://127.0.0.1:46210@evil.test/",
    "http://127.0.0.1:46210/path/",
    "http://127.0.0.1:46210/?redirect=evil",
    "http://127.0.0.1:46210/#fragment",
    "http://127.0.0.1:46210",
  ])("rejects a URL outside the native preview contract in V1 and V2: %s", async (url) => {
    expect(() => parseNativePortForwardProfile(liveProfile(url))).toThrow("Native port-forward projection is invalid");
    platform.startPortForward.mockResolvedValue(JSON.stringify(liveProfile(url)));
    await expect(createClosedPortTransport().start(savedServerId("server-test"), "forward-test"))
      .rejects.toThrow("Native port-forward profile is invalid");
  });
});
