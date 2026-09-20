import { unknownRecord } from "./unknownRecord";

export const GLOBAL_VOICE_ORB_STYLE_PREFERENCE_ID = "voice-assistant-orb-style";

/** Supported floating-overlay renderer identifiers. */
export const globalVoiceOrbStyles = ["nebula", "particles"] as const;

/** One validated floating-overlay renderer identifier. */
export type GlobalVoiceOrbStyle = (typeof globalVoiceOrbStyles)[number];

/** Missing or invalid preferences preserve the production renderer. */
export const DEFAULT_GLOBAL_VOICE_ORB_STYLE: GlobalVoiceOrbStyle = "nebula";

function isGlobalVoiceOrbStyle(value: unknown): value is GlobalVoiceOrbStyle {
  return globalVoiceOrbStyles.some((style) => style === value);
}

/** Decodes one independently versioned visual preference and preserves legacy Nebula behavior. */
export function decodeGlobalVoiceOrbStyle(value: string | null | undefined): GlobalVoiceOrbStyle {
  if (value === null || value === undefined) {
    return DEFAULT_GLOBAL_VOICE_ORB_STYLE;
  }
  try {
    const parsed = unknownRecord(JSON.parse(value));
    if (parsed === null || parsed.schemaVersion !== 1) {
      return DEFAULT_GLOBAL_VOICE_ORB_STYLE;
    }
    return isGlobalVoiceOrbStyle(parsed.style) ? parsed.style : DEFAULT_GLOBAL_VOICE_ORB_STYLE;
  } catch {
    return DEFAULT_GLOBAL_VOICE_ORB_STYLE;
  }
}

export function encodeGlobalVoiceOrbStyle(style: GlobalVoiceOrbStyle): string {
  return JSON.stringify({ schemaVersion: 1, style });
}
