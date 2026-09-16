import { useLiveQuery } from "@tanstack/react-db";
import type { ReactNode } from "react";

import type { WorkspaceResourceDatabase } from "../data/workspace-resource-database";
import type { VoiceInputController } from "../data/voice-input-controller";
import { useReducedMotionPreference } from "../rendering/reduced-motion-store";
import { VoiceAura } from "./VoiceAura";

/** Recording updates belong to the aura, not to its workspace children. */
export function WorkspaceVoiceAura({
  children,
  controller,
  resources,
}: {
  children: ReactNode;
  controller: VoiceInputController | null;
  resources: Pick<WorkspaceResourceDatabase, "voiceInputs"> | null;
}) {
  const query = useLiveQuery(() => resources?.voiceInputs, [resources]);
  const recording = query.data?.find((row) => row.phase === "recording") ?? null;
  const reducedMotion = useReducedMotionPreference();
  return (
    <VoiceAura
      controller={controller}
      phase={recording === null ? "idle" : "recording"}
      reducedMotion={reducedMotion}
      scope={recording?.scope ?? null}
    >
      {children}
    </VoiceAura>
  );
}
