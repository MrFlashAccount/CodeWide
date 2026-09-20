/** Web has no cross-application system-overlay permission. */
export type GlobalVoiceOrbLaunchOrigin = {
  readonly centerX: number;
  readonly centerY: number;
  readonly diameter: number;
};

export async function ensureGlobalVoiceOverlayPermission(): Promise<
  "granted" | "requested" | "unavailable"
> {
  await Promise.resolve();
  return "unavailable";
}

/** Web has no floating native overlay to receive a launch origin. */
export function stageGlobalVoiceOrbLaunchOrigin(_origin: GlobalVoiceOrbLaunchOrigin | null): void {}

/** Web owns no native header target. */
export function clearGlobalVoiceOrbLaunchOrigin(): void {}
