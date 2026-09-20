import { useLiveQuery } from "@tanstack/react-db";

import { getUserPreferencesDatabase } from "../../data/user-preferences-database";
import {
  decodeVoiceAssistantPersonality,
  encodeVoiceAssistantPersonality,
  VOICE_ASSISTANT_PERSONALITY_PREFERENCE_ID,
  type VoiceAssistantPersonality,
} from "../../data/voiceAssistantPersonality";
import { useEvent } from "../../react/useEvent";

const database = getUserPreferencesDatabase();

/** Reads and persists the single device-wide Voice Assistant behavior profile. */
export function useVoiceAssistantPersonality(): {
  readonly personality: VoiceAssistantPersonality;
  readonly savePersonality: (personality: VoiceAssistantPersonality) => Promise<void>;
} {
  const query = useLiveQuery(() => database.collection);
  const row = query.data?.find(
    (candidate) => candidate.id === VOICE_ASSISTANT_PERSONALITY_PREFERENCE_ID,
  );
  const personality = decodeVoiceAssistantPersonality(row?.value);
  const savePersonality = useEvent(async (next: VoiceAssistantPersonality) => {
    await database.update(VOICE_ASSISTANT_PERSONALITY_PREFERENCE_ID, () =>
      encodeVoiceAssistantPersonality(next),
    );
  });
  return { personality, savePersonality };
}
