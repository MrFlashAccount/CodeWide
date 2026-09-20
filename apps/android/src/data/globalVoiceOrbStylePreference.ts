import { getUserPreferencesDatabase } from "./user-preferences-database";
import {
  DEFAULT_GLOBAL_VOICE_ORB_STYLE,
  decodeGlobalVoiceOrbStyle,
  encodeGlobalVoiceOrbStyle,
  GLOBAL_VOICE_ORB_STYLE_PREFERENCE_ID,
  type GlobalVoiceOrbStyle,
} from "./globalVoiceOrbStyle";
import { globalVoiceOrbStyle$ } from "./globalVoiceOrbStyleState";

export { globalVoiceOrbStyle$ } from "./globalVoiceOrbStyleState";

const database = getUserPreferencesDatabase();

/** Hydrates the reactive renderer source inside the existing V1 database boot barrier. */
export async function hydrateGlobalVoiceOrbStylePreference(): Promise<GlobalVoiceOrbStyle> {
  try {
    await database.ready;
    const style = decodeGlobalVoiceOrbStyle(
      database.collection.get(GLOBAL_VOICE_ORB_STYLE_PREFERENCE_ID)?.value,
    );
    globalVoiceOrbStyle$.set(style);
    return style;
  } catch {
    globalVoiceOrbStyle$.set(DEFAULT_GLOBAL_VOICE_ORB_STYLE);
    return DEFAULT_GLOBAL_VOICE_ORB_STYLE;
  }
}

/** Persists only the visual renderer choice in its own preference record. */
export async function writeGlobalVoiceOrbStylePreference(
  style: GlobalVoiceOrbStyle,
): Promise<void> {
  await database.update(GLOBAL_VOICE_ORB_STYLE_PREFERENCE_ID, () =>
    encodeGlobalVoiceOrbStyle(style),
  );
  globalVoiceOrbStyle$.set(style);
}
