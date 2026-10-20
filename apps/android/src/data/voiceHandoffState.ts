import { observablePrimitive } from "@legendapp/state";

import {
  DEFAULT_VOICE_HANDOFF_BEHAVIOR,
  type VoiceHandoffBehavior,
} from "./voiceHandoffPreferences";

/** Process-wide runtime projection of the persisted cross-input microphone policy. */
export const voiceHandoffBehavior$ = observablePrimitive<VoiceHandoffBehavior>(
  DEFAULT_VOICE_HANDOFF_BEHAVIOR,
);
