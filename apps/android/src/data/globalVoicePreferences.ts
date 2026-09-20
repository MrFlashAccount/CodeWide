import { unknownRecord } from "./unknownRecord";

export const GLOBAL_VOICE_PREFERENCE_ID = "global-voice";

export const globalVoiceNames = [
  "arbor",
  "breeze",
  "cove",
  "ember",
  "juniper",
  "maple",
  "sol",
  "spruce",
  "vale",
] as const;

export type GlobalVoiceName = (typeof globalVoiceNames)[number];

export const DEFAULT_GLOBAL_VOICE: GlobalVoiceName = "cove";

function isGlobalVoiceName(value: unknown): value is GlobalVoiceName {
  return globalVoiceNames.some((voice) => voice === value);
}

export function decodeGlobalVoicePreference(value: string | null | undefined): GlobalVoiceName {
  if (value === null || value === undefined) {
    return DEFAULT_GLOBAL_VOICE;
  }
  try {
    const parsed = unknownRecord(JSON.parse(value));
    if (parsed === null || (parsed.schemaVersion !== undefined && parsed.schemaVersion !== 1)) {
      return DEFAULT_GLOBAL_VOICE;
    }
    return isGlobalVoiceName(parsed.voice) ? parsed.voice : DEFAULT_GLOBAL_VOICE;
  } catch {
    return DEFAULT_GLOBAL_VOICE;
  }
}

export function encodeGlobalVoicePreference(voice: GlobalVoiceName): string {
  return JSON.stringify({ schemaVersion: 1, voice });
}
