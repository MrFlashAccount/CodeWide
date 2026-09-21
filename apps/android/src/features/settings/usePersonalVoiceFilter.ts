import { useLiveQuery } from "@tanstack/react-db";
import { useState } from "react";

import {
  decodePersonalVoiceFilterPreferences,
  encodePersonalVoiceFilterPreferences,
  PERSONAL_VOICE_FILTER_PREFERENCE_ID,
} from "../../data/personalVoiceFilterPreferences";
import { getUserPreferencesDatabase } from "../../data/user-preferences-database";
import { requestMicrophonePermission } from "../../native/native-transport";
import { enrollPersonalVoice, hasPersonalVoiceProfile } from "../../native/personalVoiceFilter";
import { useEvent } from "../../react/useEvent";

const database = getUserPreferencesDatabase();

/** Owns the opt-in preference and explicit local enrollment mutation. */
export function usePersonalVoiceFilter(): {
  readonly enabled: boolean;
  readonly enroll: () => Promise<void>;
  readonly hasProfile: boolean;
  readonly setEnabled: (enabled: boolean) => Promise<void>;
} {
  const query = useLiveQuery(() => database.collection);
  const row = query.data?.find((candidate) => candidate.id === PERSONAL_VOICE_FILTER_PREFERENCE_ID);
  const [hasProfile, setHasProfile] = useState(hasPersonalVoiceProfile);
  const enabled = hasProfile && decodePersonalVoiceFilterPreferences(row?.value).enabled;
  const enroll = useEvent(async () => {
    const permission = await requestMicrophonePermission();
    if (permission !== "granted") {
      throw new Error("Microphone permission is required to record a voice profile");
    }
    await enrollPersonalVoice();
    setHasProfile(true);
  });
  const setEnabled = useEvent(async (nextEnabled: boolean) => {
    if (nextEnabled && !hasProfile) {
      throw new Error("Record a personal voice profile before enabling the filter");
    }
    await database.update(PERSONAL_VOICE_FILTER_PREFERENCE_ID, () =>
      encodePersonalVoiceFilterPreferences({ enabled: nextEnabled }),
    );
  });
  return { enabled, enroll, hasProfile, setEnabled };
}
