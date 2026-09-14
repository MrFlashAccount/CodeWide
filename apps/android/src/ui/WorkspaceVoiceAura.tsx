import { useLiveQuery } from "@tanstack/react-db";
import type { ReactNode } from "react";

import type { WorkspaceResourceDatabase } from "../data/workspace-resource-database";
import type { VoiceInputController } from "../data/voice-input-controller";
import { useReducedMotionPreference } from "../rendering/reduced-motion-store";
import { VoiceAura } from "./VoiceAura";

/** Recording updates belong to the aura, not to its workspace children. */
export function WorkspaceVoiceAura({ resources, controller, children }: {
  resources: Pick<WorkspaceResourceDatabase, "voiceInputs"> | null;
  controller: VoiceInputController | null;
  children: ReactNode;
}) {
  const query = useLiveQuery(() => resources?.voiceInputs, [resources]);
  const recording = query.data?.find((row) => row.phase === "recording") ?? null;
  const reducedMotion = useReducedMotionPreference();
  return <VoiceAura
    phase={recording === null ? "idle" : "recording"}
    scope={recording?.scope ?? null}
    controller={controller}
    reducedMotion={reducedMotion}
  >{children}</VoiceAura>;
}
