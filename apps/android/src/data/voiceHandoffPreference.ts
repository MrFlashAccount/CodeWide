import { getUserPreferencesDatabase } from "./user-preferences-database";
import {
  decodeVoiceHandoffPreference,
  DEFAULT_VOICE_HANDOFF_BEHAVIOR,
  encodeVoiceHandoffPreference,
  type VoiceHandoffBehavior,
  VOICE_HANDOFF_PREFERENCE_ID,
} from "./voiceHandoffPreferences";
import { voiceHandoffBehavior$ } from "./voiceHandoffState";

export { voiceHandoffBehavior$ } from "./voiceHandoffState";

const database = getUserPreferencesDatabase();

/** Hydrates the process-wide cross-input microphone policy during workspace startup. */
export async function hydrateVoiceHandoffPreference(): Promise<VoiceHandoffBehavior> {
  try {
    await database.ready;
    const behavior = decodeVoiceHandoffPreference(
      database.collection.get(VOICE_HANDOFF_PREFERENCE_ID)?.value,
    );
    voiceHandoffBehavior$.set(behavior);
    return behavior;
  } catch {
    voiceHandoffBehavior$.set(DEFAULT_VOICE_HANDOFF_BEHAVIOR);
    return DEFAULT_VOICE_HANDOFF_BEHAVIOR;
  }
}

/** Persists and immediately applies the cross-input microphone handoff policy. */
export async function writeVoiceHandoffPreference(behavior: VoiceHandoffBehavior): Promise<void> {
  await database.update(VOICE_HANDOFF_PREFERENCE_ID, () => encodeVoiceHandoffPreference(behavior));
  voiceHandoffBehavior$.set(behavior);
}
