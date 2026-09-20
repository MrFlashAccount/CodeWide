import { useLiveQuery } from "@tanstack/react-db";

import {
  decodeGlobalVoicePreference,
  encodeGlobalVoicePreference,
  GLOBAL_VOICE_PREFERENCE_ID,
  type GlobalVoiceName,
} from "../../data/globalVoicePreferences";
import { getUserPreferencesDatabase } from "../../data/user-preferences-database";
import { useEvent } from "../../react/useEvent";

const database = getUserPreferencesDatabase();

/** Reads and persists the device-wide Global Voice selection. */
export function useGlobalVoicePreference(): {
  readonly selectedVoice: GlobalVoiceName;
  readonly selectVoice: (voice: GlobalVoiceName) => Promise<void>;
} {
  const query = useLiveQuery(() => database.collection);
  const row = query.data?.find((candidate) => candidate.id === GLOBAL_VOICE_PREFERENCE_ID);
  const selectedVoice = decodeGlobalVoicePreference(row?.value);
  const selectVoice = useEvent(async (voice: GlobalVoiceName) => {
    await database.update(GLOBAL_VOICE_PREFERENCE_ID, () => encodeGlobalVoicePreference(voice));
  });
  return { selectedVoice, selectVoice };
}
