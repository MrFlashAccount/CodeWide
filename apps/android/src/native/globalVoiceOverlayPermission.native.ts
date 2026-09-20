import { NativeModules } from "react-native";

type GlobalVoiceOverlayBridge = {
  readonly canDrawOverlays: () => Promise<unknown>;
  readonly openOverlaySettings: () => Promise<void>;
};

type GlobalVoiceOverlayPermissionResult = "granted" | "requested" | "unavailable";

export type GlobalVoiceOrbLaunchOrigin = {
  readonly centerX: number;
  readonly centerY: number;
  readonly diameter: number;
};

function bridgeOrNull(): GlobalVoiceOverlayBridge | null {
  const candidate: unknown = NativeModules.CodeWideGlobalVoiceForeground;
  if (typeof candidate !== "object" || candidate === null) {
    return null;
  }
  const canDrawOverlays: unknown = Reflect.get(candidate, "canDrawOverlays");
  const openOverlaySettings: unknown = Reflect.get(candidate, "openOverlaySettings");
  if (typeof canDrawOverlays !== "function" || typeof openOverlaySettings !== "function") {
    return null;
  }
  return {
    async canDrawOverlays(): Promise<unknown> {
      const result: unknown = await Reflect.apply(canDrawOverlays, candidate, []);
      return result;
    },
    async openOverlaySettings(): Promise<void> {
      await Reflect.apply(openOverlaySettings, candidate, []);
    },
  };
}

/** Opens Android's app-specific overlay permission screen only when the grant is missing. */
export async function ensureGlobalVoiceOverlayPermission(): Promise<GlobalVoiceOverlayPermissionResult> {
  const bridge = bridgeOrNull();
  if (bridge === null) {
    return "unavailable";
  }
  const granted = await bridge.canDrawOverlays();
  if (granted === true) {
    return "granted";
  }
  if (granted !== false) {
    throw new Error("Global Voice overlay permission returned an invalid result");
  }
  await bridge.openOverlaySettings();
  return "requested";
}

/** Stages the in-app orb geometry for the next native overlay creation. */
export function stageGlobalVoiceOrbLaunchOrigin(origin: GlobalVoiceOrbLaunchOrigin | null): void {
  if (origin === null) {
    return;
  }
  const candidate: unknown = NativeModules.CodeWideGlobalVoiceForeground;
  if (typeof candidate !== "object" || candidate === null) {
    return;
  }
  const setOrbLaunchOrigin: unknown = Reflect.get(candidate, "setOrbLaunchOrigin");
  if (typeof setOrbLaunchOrigin === "function") {
    Reflect.apply(setOrbLaunchOrigin, candidate, [origin.centerX, origin.centerY, origin.diameter]);
  }
}

/** Clears a stale header target when the owning top-bar action leaves the viewport tree. */
export function clearGlobalVoiceOrbLaunchOrigin(): void {
  const candidate: unknown = NativeModules.CodeWideGlobalVoiceForeground;
  if (typeof candidate !== "object" || candidate === null) {
    return;
  }
  const clearOrbLaunchOrigin: unknown = Reflect.get(candidate, "clearOrbLaunchOrigin");
  if (typeof clearOrbLaunchOrigin === "function") {
    Reflect.apply(clearOrbLaunchOrigin, candidate, []);
  }
}
