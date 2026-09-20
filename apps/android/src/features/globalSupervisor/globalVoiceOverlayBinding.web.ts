import type { GlobalSupervisorFeature } from "./globalSupervisorContract";

/** Web owns no floating system overlay. */
export function bindGlobalVoiceOverlayActions(
  _feature: Pick<GlobalSupervisorFeature, "render$" | "stop">,
): void {}
