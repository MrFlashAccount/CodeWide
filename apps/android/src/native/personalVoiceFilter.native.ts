import { NativeEventEmitter, NativeModules } from "react-native";

import type {
  PersonalVoiceEnrollmentResult,
  PersonalVoiceFilterDecision,
  PersonalVoiceFilterLease,
} from "./personalVoiceFilterContract";

type PersonalVoiceFilterBridge = {
  readonly addListener: (eventName: string) => void;
  readonly hasProfile: boolean;
  readonly removeListeners: (count: number) => void;
  readonly startEnrollment: () => Promise<unknown>;
  readonly startFiltering: () => Promise<unknown>;
  readonly stopFiltering: () => void;
};

const FILTER_DECISION_EVENT = "CodeWidePersonalVoiceFilterDecision";

function bridgeOrNull(): PersonalVoiceFilterBridge | null {
  const candidate: unknown = NativeModules.CodeWidePersonalVoiceFilter;
  if (candidate === null || typeof candidate !== "object") {
    return null;
  }
  // WHY: React Native owns this same-binary registry and exposes no generated TypeScript contract for the registered module.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return candidate as PersonalVoiceFilterBridge;
}

function isSimilarity(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -1 && value <= 1;
}

function validDecision(value: unknown): value is PersonalVoiceFilterDecision {
  if (value === null || typeof value !== "object") {
    return false;
  }
  return (
    "open" in value &&
    typeof value.open === "boolean" &&
    "similarity" in value &&
    isSimilarity(value.similarity)
  );
}

/** Returns the synchronously loaded local profile status published by the native module. */
export function hasPersonalVoiceProfile(): boolean {
  return bridgeOrNull()?.hasProfile === true;
}

/** Records a bounded local sample and stores only its spectral embedding. */
export async function enrollPersonalVoice(): Promise<PersonalVoiceEnrollmentResult> {
  const bridge = bridgeOrNull();
  if (bridge === null) {
    throw new Error("Personal voice filtering is unavailable in this build");
  }
  const result = await bridge.startEnrollment();
  if (
    result === null ||
    typeof result !== "object" ||
    !("hasProfile" in result) ||
    result.hasProfile !== true
  ) {
    throw new Error("Personal voice enrollment returned an invalid result");
  }
  return { hasProfile: true };
}

/** Starts one device-local decision stream for the current Global Voice microphone track. */
export async function startPersonalVoiceFilter(
  onDecision: (decision: PersonalVoiceFilterDecision) => void,
): Promise<PersonalVoiceFilterLease | null> {
  const bridge = bridgeOrNull();
  if (bridge === null) {
    return null;
  }
  const emitter = new NativeEventEmitter(bridge);
  const subscription = emitter.addListener(FILTER_DECISION_EVENT, (value: unknown) => {
    if (validDecision(value)) {
      onDecision(value);
    }
  });
  try {
    const result = await bridge.startFiltering();
    if (
      result === null ||
      typeof result !== "object" ||
      !("active" in result) ||
      result.active !== true
    ) {
      subscription.remove();
      return null;
    }
  } catch (error) {
    subscription.remove();
    throw error;
  }
  let stopped = false;
  return {
    stop(): void {
      if (stopped) {
        return;
      }
      stopped = true;
      subscription.remove();
      bridge.stopFiltering();
    },
  };
}
