import { describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => {
  const listeners = new Map<string, () => void>();
  return {
    bridge: {
      addListener: vi.fn(),
      removeListeners: vi.fn(),
      setMicrophoneMuted: vi.fn(),
      setOrbReducedMotion: vi.fn(),
      setOrbLaunchOrigin: vi.fn(),
      setOrbState: vi.fn(),
      setOrbStyle: vi.fn(),
    },
    listeners,
    reduceMotionListeners: new Set<(reducedMotion: boolean) => void>(),
  };
});

// WHY: React Native's native event registry is unavailable in the Node test runtime.
// The real overlay action adapter runs against only that external platform replacement.
vi.mock("react-native", () => ({
  AccessibilityInfo: {
    addEventListener: vi.fn((_eventName: string, listener: (reducedMotion: boolean) => void) => {
      platform.reduceMotionListeners.add(listener);
      return { remove: () => platform.reduceMotionListeners.delete(listener) };
    }),
    isReduceMotionEnabled: vi.fn(async () => false),
  },
  NativeEventEmitter: class {
    addListener(eventName: string, listener: () => void) {
      platform.listeners.set(eventName, listener);
      return { remove: vi.fn() };
    }
  },
  NativeModules: { CodeWideGlobalVoiceForeground: platform.bridge },
}));

import { observablePrimitive } from "@legendapp/state";

import { globalVoiceOrbStyle$ } from "../src/data/globalVoiceOrbStyleState";
import type { GlobalSupervisorRenderSnapshot } from "../src/features/globalSupervisor/globalSupervisorContract";
import { bindGlobalVoiceOverlayActions } from "../src/features/globalSupervisor/globalVoiceOverlayBinding.native";
import { globalVoiceOrbStateForPhase } from "../src/features/globalSupervisor/globalVoiceOrbState";
import { applyGlobalVoiceOrbState } from "../src/native/globalVoiceOverlayActions.native";

const ready: GlobalSupervisorRenderSnapshot = {
  activity: null,
  home: { connectionId: "server", threadId: "thread" },
  phase: "ready",
  recovery: null,
  target: null,
  transcript: [],
};

describe("Global Voice overlay actions", () => {
  it("routes Stop and live state through the single feature binding", async () => {
    const stop = vi.fn(async () => undefined);
    const toggleMicrophone = vi.fn(async () => undefined);
    const render$ = observablePrimitive<GlobalSupervisorRenderSnapshot>(ready);
    const microphoneMuted$ = observablePrimitive(false);
    bindGlobalVoiceOverlayActions({ microphoneMuted$, render$, stop, toggleMicrophone });

    expect(platform.bridge.setMicrophoneMuted).toHaveBeenLastCalledWith(false);
    expect(platform.bridge.setOrbState).toHaveBeenLastCalledWith("idle");
    render$.set({ ...ready, phase: "listening" });
    expect(platform.bridge.setOrbState).toHaveBeenLastCalledWith("listening");
    render$.set({ ...ready, phase: "thinking" });
    expect(platform.bridge.setOrbState).toHaveBeenLastCalledWith("thinking");
    render$.set({ ...ready, phase: "speaking" });
    expect(platform.bridge.setOrbState).toHaveBeenLastCalledWith("speaking");

    platform.listeners.get("CodeWideGlobalVoiceOverlayStop")?.();

    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());

    platform.listeners.get("CodeWideGlobalVoiceOverlayMicrophoneToggle")?.();
    await vi.waitFor(() => expect(toggleMicrophone).toHaveBeenCalledOnce());
    microphoneMuted$.set(true);
    expect(platform.bridge.setMicrophoneMuted).toHaveBeenLastCalledWith(true);
  });

  it("maps every supervisor phase and live-applies style and reduced motion", async () => {
    const phases: readonly GlobalSupervisorRenderSnapshot["phase"][] = [
      "unbound",
      "activating",
      "creating",
      "ready",
      "starting",
      "listening",
      "reconnecting",
      "thinking",
      "speaking",
      "toolActivity",
      "stopping",
      "failed",
    ];
    expect(phases.map(globalVoiceOrbStateForPhase)).toEqual([
      "disabled",
      "connecting",
      "connecting",
      "idle",
      "connecting",
      "listening",
      "connecting",
      "thinking",
      "speaking",
      "thinking",
      "disabled",
      "error",
    ]);

    globalVoiceOrbStyle$.set("particles");
    expect(platform.bridge.setOrbStyle).toHaveBeenLastCalledWith("particles");
    applyGlobalVoiceOrbState("speaking");
    expect(platform.bridge.setOrbState).toHaveBeenLastCalledWith("speaking");
    platform.reduceMotionListeners.forEach((listener) => listener(true));
    expect(platform.bridge.setOrbReducedMotion).toHaveBeenLastCalledWith(true);
    await vi.waitFor(() => expect(platform.bridge.setOrbReducedMotion).toHaveBeenCalledWith(false));
    globalVoiceOrbStyle$.set("nebula");
  });
});
