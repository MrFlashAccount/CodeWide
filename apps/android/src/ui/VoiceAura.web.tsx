import type { ReactNode } from "react";
import type { VoiceInputController } from "../data/voice-input-controller";

export function VoiceAura({ children }: { phase: "idle" | "recording" | "transcribing"; controller: VoiceInputController | null; scope: string | null; reducedMotion: boolean; children: ReactNode }) {
  return children;
}
