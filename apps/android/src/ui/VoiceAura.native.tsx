import type { ReactNode } from "react";
import { useEffect } from "react";

import { setNativeVoiceAuraState } from "../native/native-transport.native";
import type { VoiceInputController } from "../data/voice-input-controller";
import { usePerformanceExperiment } from "../data/performance-experiments";
import { useVoiceInputLevel } from "./VoiceInputRuntime";

export type VoiceAuraPhase = "idle" | "recording" | "transcribing";

/**
 * Keeps React responsible only for the recording lifecycle. Android applies
 * the original Reacticx shader to the live root RenderNode on the GPU.
 */
export function VoiceAura({
  phase,
  controller,
  scope,
  reducedMotion,
  children,
}: {
  phase: VoiceAuraPhase;
  controller: VoiceInputController | null;
  scope: string | null;
  reducedMotion: boolean;
  children: ReactNode;
}) {
  const motionExperimentDisabled = usePerformanceExperiment("reduceCustomMotion");
  const active = phase !== "idle" && !motionExperimentDisabled;
  const level = useVoiceInputLevel(controller, active ? scope : null);

  useEffect(() => {
    setNativeVoiceAuraState(active, level, reducedMotion);
  }, [active, level, reducedMotion]);

  useEffect(() => () => {
    setNativeVoiceAuraState(false, 0, false);
  }, []);

  return children;
}
