import {
  applyGlobalVoiceOrbState,
  applyGlobalVoiceOrbStyle,
  bindGlobalVoiceOrbReducedMotion,
  bindGlobalVoiceOverlayStop,
} from "../../native/globalVoiceOverlayActions.native";
import { globalVoiceOrbStyle$ } from "../../data/globalVoiceOrbStyleState";
import type { GlobalSupervisorFeature } from "./globalSupervisorContract";
import { globalVoiceOrbStateForPhase } from "./globalVoiceOrbState";

let disposeStateSubscription: (() => void) | null = null;
let disposeStyleSubscription: (() => void) | null = null;

/** Binds the Android overlay to the single Global Supervisor feature owner. */
export function bindGlobalVoiceOverlayActions(
  feature: Pick<GlobalSupervisorFeature, "render$" | "stop">,
): void {
  bindGlobalVoiceOverlayStop(feature.stop);
  disposeStateSubscription?.();
  disposeStateSubscription = feature.render$.onChange(
    ({ value }) => {
      applyGlobalVoiceOrbState(globalVoiceOrbStateForPhase(value.phase));
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
