import {
  applyGlobalVoiceMicrophoneMuted,
  applyGlobalVoiceOrbState,
  applyGlobalVoiceOrbStyle,
  applyGlobalVoiceOverlayChatTarget,
  bindGlobalVoiceOrbReducedMotion,
  bindGlobalVoiceOverlayMicrophoneToggle,
  bindGlobalVoiceOverlayStop,
} from "../../native/globalVoiceOverlayActions.native";
import { globalVoiceOrbStyle$ } from "../../data/globalVoiceOrbStyleState";
import type { GlobalSupervisorFeature } from "./globalSupervisorContract";
import { globalVoiceOrbStateForPhase } from "./globalVoiceOrbState";

let disposeStateSubscription: (() => void) | null = null;
let disposeStyleSubscription: (() => void) | null = null;
let disposeMicrophoneSubscription: (() => void) | null = null;

/** Binds the Android overlay to the single Global Supervisor feature owner. */
export function bindGlobalVoiceOverlayActions(
  feature: Pick<
    GlobalSupervisorFeature,
    "microphoneMuted$" | "render$" | "stop" | "toggleMicrophone"
  >,
): void {
  bindGlobalVoiceOverlayStop(feature.stop);
  bindGlobalVoiceOverlayMicrophoneToggle(feature.toggleMicrophone);
  disposeMicrophoneSubscription?.();
  disposeMicrophoneSubscription = feature.microphoneMuted$.onChange(
    ({ value }) => {
      applyGlobalVoiceMicrophoneMuted(value);
    },
    { initial: true },
  );
  disposeStateSubscription?.();
  disposeStateSubscription = feature.render$.onChange(
    ({ value }) => {
      applyGlobalVoiceOrbState(globalVoiceOrbStateForPhase(value.phase));
      const home = value.home;
      applyGlobalVoiceOverlayChatTarget(
        home !== null &&
          home.threadId !== null &&
          value.phase !== "failed" &&
          value.phase !== "stopping"
          ? { connectionId: home.connectionId, threadId: home.threadId }
          : null,
      );
    },
    { initial: true },
  );
  disposeStyleSubscription?.();
  disposeStyleSubscription = globalVoiceOrbStyle$.onChange(
    ({ value }) => {
      applyGlobalVoiceOrbStyle(value);
    },
    { initial: true },
  );
  bindGlobalVoiceOrbReducedMotion();
}
