import { describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => {
  const listeners = new Map<string, (value: unknown) => void>();
  return {
    bridge: {
      addListener: vi.fn(),
      removeListeners: vi.fn(),
      setMicrophoneMuted: vi.fn(),
      setOverlayChatTarget: vi.fn(),
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
    addListener(eventName: string, listener: (value: unknown) => void) {
      platform.listeners.set(eventName, listener);
      return { remove: vi.fn() };
    }
  },
  NativeModules: { CodeWideGlobalVoiceForeground: platform.bridge },
}));

import {
  activateGlobalVoiceOverlayActions,
  releaseGlobalVoiceOverlayActions,
} from "../src/native/globalVoiceOverlayActionLease";

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
    activateGlobalVoiceOverlayActions("first-lease");
    const stop = vi.fn(async () => undefined);
    const toggleMicrophone = vi.fn(async () => undefined);
    const render$ = observablePrimitive<GlobalSupervisorRenderSnapshot>(ready);
    const microphoneMuted$ = observablePrimitive(false);
    bindGlobalVoiceOverlayActions({ microphoneMuted$, render$, stop, toggleMicrophone });

    expect(platform.bridge.setOverlayChatTarget).toHaveBeenLastCalledWith("server", "thread");

    expect(platform.bridge.setMicrophoneMuted).toHaveBeenLastCalledWith(false);
    expect(platform.bridge.setOrbState).toHaveBeenLastCalledWith("idle");
    render$.set({ ...ready, phase: "listening" });
    expect(platform.bridge.setOrbState).toHaveBeenLastCalledWith("listening");
    render$.set({ ...ready, phase: "thinking" });
    expect(platform.bridge.setOrbState).toHaveBeenLastCalledWith("thinking");
    render$.set({ ...ready, phase: "speaking" });
    expect(platform.bridge.setOrbState).toHaveBeenLastCalledWith("speaking");

    platform.listeners.get("CodeWideGlobalVoiceOverlayStop")?.({ token: "first-lease" });

    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce());

    platform.listeners.get("CodeWideGlobalVoiceOverlayMicrophoneToggle")?.({
      token: "first-lease",
    });
    await vi.waitFor(() => expect(toggleMicrophone).toHaveBeenCalledOnce());
    microphoneMuted$.set(true);
    expect(platform.bridge.setMicrophoneMuted).toHaveBeenLastCalledWith(true);
    releaseGlobalVoiceOverlayActions("first-lease");
    activateGlobalVoiceOverlayActions("second-lease");
    platform.listeners.get("CodeWideGlobalVoiceOverlayStop")?.({ token: "first-lease" });
    platform.listeners.get("CodeWideGlobalVoiceOverlayMicrophoneToggle")?.({
      token: "first-lease",
    });
    await Promise.resolve();
    expect(stop).toHaveBeenCalledOnce();
    expect(toggleMicrophone).toHaveBeenCalledOnce();
  });

  it("publishes the exact replacement supervisor home and clears unavailable destinations", () => {
    const stop = vi.fn(async () => undefined);
    const toggleMicrophone = vi.fn(async () => undefined);
    const render$ = observablePrimitive<GlobalSupervisorRenderSnapshot>({
      ...ready,
      phase: "listening",
    });
    bindGlobalVoiceOverlayActions({
      microphoneMuted$: observablePrimitive(false),
      render$,
      stop,
      toggleMicrophone,
    });
    render$.set({
      ...ready,
      home: { connectionId: "other-server", threadId: "replacement-home" },
      phase: "reconnecting",
    });
    expect(platform.bridge.setOverlayChatTarget).toHaveBeenLastCalledWith(
      "other-server",
      "replacement-home",
    );
    render$.set({ ...ready, phase: "stopping" });
    expect(platform.bridge.setOverlayChatTarget).toHaveBeenLastCalledWith(null, null);
    render$.set({
      ...ready,
      home: { connectionId: "other-server", threadId: null },
      phase: "creating",
    });
    expect(platform.bridge.setOverlayChatTarget).toHaveBeenLastCalledWith(null, null);
    expect(stop).not.toHaveBeenCalled();
    expect(toggleMicrophone).not.toHaveBeenCalled();
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
