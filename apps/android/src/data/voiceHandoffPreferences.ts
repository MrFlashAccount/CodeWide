import { unknownRecord } from "./unknownRecord";

export const VOICE_HANDOFF_PREFERENCE_ID = "voice-handoff";

const voiceHandoffBehaviors = ["disable", "stop", "send"] as const;

export type VoiceHandoffBehavior = (typeof voiceHandoffBehaviors)[number];

export const DEFAULT_VOICE_HANDOFF_BEHAVIOR: VoiceHandoffBehavior = "send";

function isVoiceHandoffBehavior(value: unknown): value is VoiceHandoffBehavior {
  return voiceHandoffBehaviors.some((behavior) => behavior === value);
}

export function decodeVoiceHandoffPreference(
  value: string | null | undefined,
): VoiceHandoffBehavior {
  if (value === null || value === undefined) {
    return DEFAULT_VOICE_HANDOFF_BEHAVIOR;
  }
  try {
    const parsed = unknownRecord(JSON.parse(value));
    if (parsed === null || (parsed.schemaVersion !== undefined && parsed.schemaVersion !== 1)) {
      return DEFAULT_VOICE_HANDOFF_BEHAVIOR;
    }
    return isVoiceHandoffBehavior(parsed.behavior)
      ? parsed.behavior
      : DEFAULT_VOICE_HANDOFF_BEHAVIOR;
  } catch {
    return DEFAULT_VOICE_HANDOFF_BEHAVIOR;
  }
}

export function encodeVoiceHandoffPreference(behavior: VoiceHandoffBehavior): string {
  return JSON.stringify({ behavior, schemaVersion: 1 });
}
