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
const MAX_SERVER_VOICE_NAME_CHARACTERS = 32;
const MAX_SERVER_VOICES = 64;

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

function validServerVoice(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_SERVER_VOICE_NAME_CHARACTERS
  );
}

function validServerVoiceList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_SERVER_VOICES &&
    value.every(validServerVoice)
  );
}

/** Validates live voice availability and falls back to the server default when needed. */
export function resolveAvailableGlobalVoice(value: unknown, preferred: GlobalVoiceName): string {
  const response = unknownRecord(value);
  const voices = unknownRecord(response?.voices);
  const selected = voices?.defaultV1;
  const supported = voices?.v1;
  if (
    !validServerVoice(selected) ||
    !validServerVoiceList(supported) ||
    !supported.includes(selected)
  ) {
    throw new Error("The Global Voice server returned no compatible voice");
  }
  return supported.includes(preferred) ? preferred : selected;
}
