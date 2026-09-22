import type { GlobalVoiceOrbStyle } from "../data/globalVoiceOrbStyle";

export type GlobalVoiceOrbState =
  | "connecting"
  | "disabled"
  | "error"
  | "idle"
  | "listening"
  | "speaking"
  | "thinking";

/** Web has no system overlay; preserve the platform-neutral settings contract. */
export function applyGlobalVoiceOrbStyle(_style: GlobalVoiceOrbStyle): void {}

/** Web has no system overlay; preserve the state adapter contract. */
export function applyGlobalVoiceOrbState(_state: GlobalVoiceOrbState): void {}

/** Web has no system overlay microphone indicator. */
export function applyGlobalVoiceMicrophoneMuted(_muted: boolean): void {}

/** Publishes the exact supervisor destination without changing catalog visibility. */
export function applyGlobalVoiceOverlayChatTarget(
  _target: { readonly connectionId: string; readonly threadId: string } | null,
): void {}

/** Web has no system overlay microphone action. */
export function bindGlobalVoiceOverlayMicrophoneToggle(_action: () => Promise<void>): void {}

/** Web has no system overlay Stop event. */
export function bindGlobalVoiceOverlayStop(_action: () => Promise<void>): void {}

/** Web follows browser motion preferences rather than an Android overlay. */
export function bindGlobalVoiceOrbReducedMotion(): void {}
