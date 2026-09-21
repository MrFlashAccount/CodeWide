import { unknownRecord } from "./unknownRecord";

export const PERSONAL_VOICE_FILTER_PREFERENCE_ID = "personal-voice-filter";

/** Device-wide opt-in for the experimental local speaker gate. */
export type PersonalVoiceFilterPreferences = {
  readonly enabled: boolean;
};

const DEFAULT_PERSONAL_VOICE_FILTER_PREFERENCES: PersonalVoiceFilterPreferences = {
  enabled: false,
};

export function decodePersonalVoiceFilterPreferences(
  value: string | null | undefined,
): PersonalVoiceFilterPreferences {
  if (value === null || value === undefined) {
    return DEFAULT_PERSONAL_VOICE_FILTER_PREFERENCES;
  }
  try {
    const parsed = unknownRecord(JSON.parse(value));
    if (parsed === null || parsed.schemaVersion !== 1 || typeof parsed.enabled !== "boolean") {
      return DEFAULT_PERSONAL_VOICE_FILTER_PREFERENCES;
    }
    return { enabled: parsed.enabled };
  } catch {
    return DEFAULT_PERSONAL_VOICE_FILTER_PREFERENCES;
  }
}

export function encodePersonalVoiceFilterPreferences(
  preferences: PersonalVoiceFilterPreferences,
): string {
  return JSON.stringify({ enabled: preferences.enabled, schemaVersion: 1 });
}
