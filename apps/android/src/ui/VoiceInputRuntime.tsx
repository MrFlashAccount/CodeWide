import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";

import type { WorkspaceResourceDatabase, VoiceInputRow } from "../data/workspace-resource-database";
import type { StartVoiceTranscription, VoiceInputController } from "../data/voice-input-controller";

export type AppVoiceInputRuntime = {
  controller: VoiceInputController | null;
  resources: WorkspaceResourceDatabase | null;
  scopePrefix: string;
  thread: Thread | null;
  startRemote?: StartVoiceTranscription;
};

const VoiceInputRuntimeContext = createContext<AppVoiceInputRuntime | null>(null);

export function AppVoiceInputProvider({ runtime, children }: { runtime: AppVoiceInputRuntime; children: ReactNode }) {
  return <VoiceInputRuntimeContext.Provider value={runtime}>{children}</VoiceInputRuntimeContext.Provider>;
}

export function useAppVoiceInputRuntime(): AppVoiceInputRuntime | null {
  return useContext(VoiceInputRuntimeContext);
}

export function useVoiceInputResource(runtime: AppVoiceInputRuntime | null, scope: string | null): VoiceInputRow | null {
  return useSyncExternalStore(
    (notify) => {
      if (runtime?.resources === null || runtime?.resources === undefined || scope === null) return () => {};
      const subscription = runtime.resources.voiceInputs.subscribeChanges((changes) => {
        if (changes.some((change) => String(change.key) === scope)) notify();
      }, { includeInitialState: false });
      return () => subscription.unsubscribe();
    },
    () => runtime?.resources?.voiceInputs.get(scope ?? "") ?? null,
    () => null,
  );
}

/** Subscribes only the tiny meter/aura surface to transient PCM levels. */
export function useVoiceInputLevel(controller: VoiceInputController | null | undefined, scope: string | null): number {
  return useSyncExternalStore(
    (notify) => controller === null || controller === undefined || scope === null
      ? () => {}
      : controller.subscribeLevel(scope, notify),
    () => controller === null || controller === undefined || scope === null ? 0 : controller.level(scope),
    () => 0,
  );
}
