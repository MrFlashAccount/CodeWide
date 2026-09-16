import type { ReactNode } from "react";
import { useEffect } from "react";

import { setNativeVoiceAuraState } from "../native/native-transport.native";
import type { VoiceInputController } from "../data/voice-input-controller";
import { usePerformanceExperiment } from "../data/performance-experiments";

export type VoiceAuraPhase = "idle" | "recording" | "transcribing";

/**
 * Keeps React responsible only for the recording lifecycle. Android applies
 * the live-root shader on the GPU; microphone levels stay in the native loop.
 */
export function VoiceAura({
  children,
  phase,
  reducedMotion,
}: {
  children: ReactNode;
  controller: VoiceInputController | null;
  phase: VoiceAuraPhase;
  reducedMotion: boolean;
  scope: string | null;
}): ReactNode {
  const motionExperimentDisabled = usePerformanceExperiment("reduceCustomMotion");
  const active = phase !== "idle" && !motionExperimentDisabled;

  useEffect(() => {
    setNativeVoiceAuraState(active, 0, reducedMotion);
  }, [active, reducedMotion]);

  useEffect(
    () => () => {
      setNativeVoiceAuraState(false, 0, false);
    },
    [],
  );

  return children;
}
