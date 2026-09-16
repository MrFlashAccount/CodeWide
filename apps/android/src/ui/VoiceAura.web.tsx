import type { ReactNode } from "react";
import type { VoiceInputController } from "../data/voice-input-controller";

export function VoiceAura({
  children,
}: {
  children: ReactNode;
  controller: VoiceInputController | null;
  phase: "idle" | "recording" | "transcribing";
  reducedMotion: boolean;
  scope: string | null;
}): ReactNode {
  return children;
}
