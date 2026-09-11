import { beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({
  listeners: new Map<string, (value: unknown) => void>(),
  request: vi.fn<() => Promise<string>>(),
  refresh: vi.fn(),
  start: vi.fn(async () => ({ sampleRate: 48_000, source: "voice_communication", noiseSuppressor: true, automaticGainControl: true })),
}));

// WHY: Android permissions and the native audio bridge are unavailable in Node.
// The real permission adapter and capture admission run against this platform boundary.
vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  NativeModules: { CodeWideNative: {
    microphonePermissionGranted: false,
    refreshMicrophonePermission: platform.refresh,
    startPcmCapture: platform.start,
    stopPcmCapture() { platform.listeners.get("CodeWideAudioEvent")?.({ type: "stopped" }); },
  } },
  NativeEventEmitter: class {
    addListener(name: string, listener: (value: unknown) => void) {
      platform.listeners.set(name, listener);
      return { remove() { platform.listeners.delete(name); } };
    }
  },
  PermissionsAndroid: {
    PERMISSIONS: { RECORD_AUDIO: "record_audio" },
    RESULTS: { GRANTED: "granted", DENIED: "denied", NEVER_ASK_AGAIN: "never_ask_again" },
    request: platform.request,
  },
}));

import { getMicrophonePermission, requestMicrophonePermission, startPcmCapture, subscribeMicrophonePermission } from "../src/native/native-transport.native";

beforeEach(() => {
  vi.clearAllMocks();
  platform.listeners.get("CodeWideMicrophonePermission")?.(true);
  platform.listeners.get("CodeWideMicrophonePermission")?.(false);
});

describe("microphone permission boundary", () => {
  it("does not request permission or start capture implicitly", async () => {
    expect(getMicrophonePermission()).toBe("denied");
    await expect(startPcmCapture(() => {}, () => {})).rejects.toThrow("Microphone permission is required");
    expect(platform.request).not.toHaveBeenCalled();
    expect(platform.start).not.toHaveBeenCalled();
    expect(platform.refresh).not.toHaveBeenCalled();
  });

  it("granting access triggers preparation but never starts recording", async () => {
    const notify = vi.fn();
    const unsubscribe = subscribeMicrophonePermission(notify);
    platform.request.mockResolvedValueOnce("granted");
    await expect(requestMicrophonePermission()).resolves.toBe("granted");
    expect(getMicrophonePermission()).toBe("granted");
    expect(platform.refresh).toHaveBeenCalledOnce();
    expect(platform.start).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("starts permitted capture without another permission request", async () => {
    platform.listeners.get("CodeWideMicrophonePermission")?.(true);
    const capture = await startPcmCapture(() => {}, () => {});
    expect(platform.start).toHaveBeenCalledOnce();
    expect(platform.request).not.toHaveBeenCalled();
    await capture.stop();
  });

  it("retains permanent denial until permission changes in Android settings", async () => {
    platform.request.mockResolvedValueOnce("never_ask_again");
    await expect(requestMicrophonePermission()).resolves.toBe("blocked");
    platform.listeners.get("CodeWideMicrophonePermission")?.(false);
    expect(getMicrophonePermission()).toBe("blocked");
    platform.listeners.get("CodeWideMicrophonePermission")?.(true);
    expect(getMicrophonePermission()).toBe("granted");
    platform.listeners.get("CodeWideMicrophonePermission")?.(false);
    expect(getMicrophonePermission()).toBe("denied");
    expect(platform.start).not.toHaveBeenCalled();
  });

  it("ignores malformed native permission events", () => {
    platform.listeners.get("CodeWideMicrophonePermission")?.("granted");
    expect(getMicrophonePermission()).toBe("denied");
  });
});
