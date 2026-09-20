import type { GlobalVoiceName } from "../../data/globalVoicePreferences";

/** Short ChatGPT-style labels shown by the Global Voice selector. */
export const globalVoiceDescriptions: Readonly<Record<GlobalVoiceName, string>> = {
  arbor: "Relaxed and versatile",
  breeze: "Animated and sincere",
  cove: "Composed and direct",
  ember: "Confident and optimistic",
  juniper: "Open and upbeat",
  maple: "Cheerful and candid",
  sol: "Savvy and relaxed",
  spruce: "Calm and affirming",
  vale: "Bright and curious",
};

/** Human-readable label for one stable realtime voice identifier. */
export function globalVoiceLabel(voice: GlobalVoiceName): string {
  return voice.charAt(0).toUpperCase() + voice.slice(1);
}
