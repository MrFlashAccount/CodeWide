import { describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  observeWebRtc: vi.fn(async (_peerId: number) => undefined),
  stopObservingWebRtc: vi.fn(),
}));
vi.mock("react-native", () => ({ NativeModules: { CodeWideGlobalVoiceForeground: bridge } }));

import { observeGlobalVoiceNativePeer } from "../src/native/globalVoiceNativePeer.native";

describe("Global Voice native peer lease", () => {
  it("binds and releases the exact existing peer without an Activity or render subscription", async () => {
    const release = await observeGlobalVoiceNativePeer(21);
    expect(bridge.observeWebRtc).toHaveBeenCalledWith(21);
    release();
    expect(bridge.stopObservingWebRtc).toHaveBeenCalledWith(21);
  });

  it("does not return a live lease after foreground admission fails", async () => {
    bridge.observeWebRtc.mockRejectedValueOnce(new Error("foreground released"));
    await expect(observeGlobalVoiceNativePeer(22)).rejects.toThrow("foreground released");
  });
});
