import { observablePrimitive } from "@legendapp/state";

import { DEFAULT_GLOBAL_VOICE_ORB_STYLE, type GlobalVoiceOrbStyle } from "./globalVoiceOrbStyle";

/** Process-wide selected renderer state shared by persistence and every mounted orb surface. */
export const globalVoiceOrbStyle$ = observablePrimitive<GlobalVoiceOrbStyle>(
  DEFAULT_GLOBAL_VOICE_ORB_STYLE,
);
