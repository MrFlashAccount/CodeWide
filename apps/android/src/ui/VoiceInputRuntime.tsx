import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";

import type { WorkspaceResourceDatabase, VoiceInputRow } from "../data/workspace-resource-database";
import type { StartVoiceTranscription, VoiceInputController } from "../data/voice-input-controller";

export type AppVoiceInputController = Pick<
  VoiceInputController,
  | "bind"
  | "clearPendingSelection"
  | "finish"
  | "level"
  | "retry"
  | "subscribeLevel"
  | "toggle"
  | "unbind"
>;

export type AppVoiceInputRuntime = {
  controller: AppVoiceInputController | null;
  resources: WorkspaceResourceDatabase | null;
  scopePrefix: string;
  startRemote?: StartVoiceTranscription;
  thread: Thread | null;
};

const VoiceInputRuntimeContext = createContext<AppVoiceInputRuntime | null>(null);

export function AppVoiceInputProvider({
  children,
  runtime,
}: {
  children: ReactNode;
  runtime: AppVoiceInputRuntime | null;
}) {
  return (
    <VoiceInputRuntimeContext.Provider value={runtime}>
      {children}
    </VoiceInputRuntimeContext.Provider>
  );
}

export function useAppVoiceInputRuntime(): AppVoiceInputRuntime | null {
  return useContext(VoiceInputRuntimeContext);
}

export function useVoiceInputResource(
  runtime: AppVoiceInputRuntime | null,
  scope: string | null,
): VoiceInputRow | null {
  return useScopedVoiceInputResource(runtime?.resources ?? null, scope);
}

/** Observe only the recording owned by one input, never the global microphone. */
export function useScopedVoiceInputResource(
  resources: Pick<WorkspaceResourceDatabase, "voiceInputs"> | null,
  scope: string | null,
): VoiceInputRow | null {
  return useSyncExternalStore(
    (notify) => {
      if (resources === null || scope === null) {
        return () => {};
      }
      const subscription = resources.voiceInputs.subscribeChanges(
        (changes) => {
          if (changes.some((change) => String(change.key) === scope)) {
            notify();
          }
        },
        { includeInitialState: false },
      );
      return () => {
        subscription.unsubscribe();
      };
    },
    () => resources?.voiceInputs.get(scope ?? "") ?? null,
    () => null,
  );
}

/** Subscribes only the tiny meter/aura surface to transient PCM levels. */
export function useVoiceInputLevel(
  controller: Pick<AppVoiceInputController, "level" | "subscribeLevel"> | null | undefined,
  scope: string | null,
): number {
  return useSyncExternalStore(
    (notify) =>
      controller === null || controller === undefined || scope === null
        ? () => {}
        : controller.subscribeLevel(scope, notify),
    () =>
      controller === null || controller === undefined || scope === null
        ? 0
        : controller.level(scope),
    () => 0,
  );
}
