import { unknownRecord } from "./unknownRecord";

export const VOICE_ASSISTANT_PERSONALITY_PREFERENCE_ID = "voice-assistant-personality";
export const VOICE_ASSISTANT_PERSONALITY_FIELD_MAX_LENGTH = 2000;

/** Device-wide behavior profile for the single V1 Voice Assistant. */
export type VoiceAssistantPersonality = {
  readonly character: string;
  readonly communicationStyle: string;
  readonly rules: string;
};

export const DEFAULT_VOICE_ASSISTANT_PERSONALITY: VoiceAssistantPersonality = {
  character: "",
  communicationStyle: "",
  rules: "",
};

function normalizeField(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .trim()
    .slice(0, VOICE_ASSISTANT_PERSONALITY_FIELD_MAX_LENGTH);
}

export function normalizeVoiceAssistantPersonality(
  personality: VoiceAssistantPersonality,
): VoiceAssistantPersonality {
  return {
    character: normalizeField(personality.character),
    communicationStyle: normalizeField(personality.communicationStyle),
    rules: normalizeField(personality.rules),
  };
}

function personalityField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function decodeParsedPersonality(value: unknown): VoiceAssistantPersonality {
  const parsed = unknownRecord(value);
  if (parsed === null || parsed.schemaVersion !== 1) {
    return DEFAULT_VOICE_ASSISTANT_PERSONALITY;
  }
  return normalizeVoiceAssistantPersonality({
    character: personalityField(parsed.character),
    communicationStyle: personalityField(parsed.communicationStyle),
    rules: personalityField(parsed.rules),
  });
}

export function decodeVoiceAssistantPersonality(
  value: string | null | undefined,
): VoiceAssistantPersonality {
  if (value === null || value === undefined) {
    return DEFAULT_VOICE_ASSISTANT_PERSONALITY;
  }
  try {
    return decodeParsedPersonality(JSON.parse(value));
  } catch {
    return DEFAULT_VOICE_ASSISTANT_PERSONALITY;
  }
}

export function encodeVoiceAssistantPersonality(personality: VoiceAssistantPersonality): string {
  const normalized = normalizeVoiceAssistantPersonality(personality);
  return JSON.stringify({ schemaVersion: 1, ...normalized });
}

export function hasCustomVoiceAssistantPersonality(
  personality: VoiceAssistantPersonality,
): boolean {
  return (
    personality.character !== "" ||
    personality.communicationStyle !== "" ||
    personality.rules !== ""
  );
}
