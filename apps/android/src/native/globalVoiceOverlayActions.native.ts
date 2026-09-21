import { AccessibilityInfo, NativeEventEmitter, NativeModules } from "react-native";

import type { GlobalVoiceOrbStyle } from "../data/globalVoiceOrbStyle";

/** Native renderer states shared by the feature binding and Android bridge. */
export type GlobalVoiceOrbState =
  | "connecting"
  | "disabled"
  | "error"
  | "idle"
  | "listening"
  | "speaking"
  | "thinking";

type GlobalVoiceOverlayBridge = {
  readonly addListener: (eventName: string) => void;
  readonly removeListeners: (count: number) => void;
  readonly setMicrophoneMuted: (muted: boolean) => void;
  readonly setOrbReducedMotion: (reducedMotion: boolean) => void;
  readonly setOrbState: (state: GlobalVoiceOrbState) => void;
  readonly setOrbStyle: (style: GlobalVoiceOrbStyle) => void;
};

const MIC_TOGGLE_EVENT_NAME = "CodeWideGlobalVoiceOverlayMicrophoneToggle";
const STOP_EVENT_NAME = "CodeWideGlobalVoiceOverlayStop";
let microphoneToggleAction: (() => Promise<void>) | null = null;
let microphoneToggleSubscribed = false;
let stopAction: (() => Promise<void>) | null = null;
let stopSubscribed = false;
let reduceMotionSubscribed = false;

function bridgeOrNull(): GlobalVoiceOverlayBridge | null {
  const candidate: unknown = NativeModules.CodeWideGlobalVoiceForeground;
  if (candidate === null || typeof candidate !== "object") {
    return null;
  }
  // WHY: React Native owns this same-binary registry and exposes no generated TypeScript contract for the registered module.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return candidate as GlobalVoiceOverlayBridge;
}

/** Applies a persisted selection to the live renderer slot when Android owns one. */
export function applyGlobalVoiceOrbStyle(style: GlobalVoiceOrbStyle): void {
  bridgeOrNull()?.setOrbStyle(style);
}

/** Applies one already-mapped feature state to the live Android renderer slot. */
export function applyGlobalVoiceOrbState(state: GlobalVoiceOrbState): void {
  bridgeOrNull()?.setOrbState(state);
}

/** Applies the feature-owned mute state to the native capture indicator and action label. */
export function applyGlobalVoiceMicrophoneMuted(muted: boolean): void {
  bridgeOrNull()?.setMicrophoneMuted(muted);
}

/** Binds the native microphone action to the current feature owner. */
export function bindGlobalVoiceOverlayMicrophoneToggle(action: () => Promise<void>): void {
  microphoneToggleAction = action;
  const bridge = bridgeOrNull();
  if (bridge === null || microphoneToggleSubscribed) {
    return;
  }
  microphoneToggleSubscribed = true;
  const emitter = new NativeEventEmitter(bridge);
  emitter.addListener(MIC_TOGGLE_EVENT_NAME, () => {
    void microphoneToggleAction?.().catch(() => {
      // The confirmed feature state remains authoritative when the media mutation fails.
    });
  });
}

/** Binds the process-lifetime native Stop event to the current feature action. */
export function bindGlobalVoiceOverlayStop(action: () => Promise<void>): void {
  stopAction = action;
  const bridge = bridgeOrNull();
  if (bridge === null) {
    return;
  }
  if (!stopSubscribed) {
    stopSubscribed = true;
    const emitter = new NativeEventEmitter(bridge);
    emitter.addListener(STOP_EVENT_NAME, () => {
      const activeAction = stopAction;
      if (activeAction === null) {
        return;
      }
      void activeAction().catch(() => {
        // The feature model publishes the bounded cleanup failure state.
      });
    });
  }
}

/** Mirrors Android's reduced-motion preference into current and future renderers. */
export function bindGlobalVoiceOrbReducedMotion(): void {
  const bridge = bridgeOrNull();
  if (bridge === null) {
    return;
  }
  if (!reduceMotionSubscribed) {
    reduceMotionSubscribed = true;
    AccessibilityInfo.addEventListener("reduceMotionChanged", (reducedMotion) => {
      bridge.setOrbReducedMotion(reducedMotion);
    });
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((reducedMotion) => {
        bridge.setOrbReducedMotion(reducedMotion);
      })
      .catch(() => undefined);
  }
}
