import { useSelector } from "@legendapp/state/react";
import { useSyncExternalStore } from "react";

import { voiceHandoffBehavior$ } from "../data/voiceHandoffState";
import type { AppVoiceInputController } from "./VoiceInputRuntime";

/** Disables only idle inputs when the selected cross-input policy forbids handoff. */
export function useVoiceInputDisabled(
  controller: AppVoiceInputController | null | undefined,
  scope: string | null,
): boolean {
  const behavior = useSelector(voiceHandoffBehavior$);
  const activeScope = useSyncExternalStore(
    (notify) => controller?.subscribeActiveCapture(notify) ?? (() => {}),
    () => controller?.activeCaptureScope() ?? null,
    () => null,
  );
  return behavior === "disable" && activeScope !== null && scope !== null && activeScope !== scope;
}
