import { observable, type Observable } from "@legendapp/state";

import type { TurnControlsValue } from "./turn-controls-types";

/** Published state for the Voice Assistant view of the shared model catalog. */
export type VoiceAssistantModelCatalogSnapshot =
  | { readonly models: readonly TurnControlsValue["models"][number][]; readonly status: "idle" }
  | { readonly models: readonly TurnControlsValue["models"][number][]; readonly status: "loading" }
  | { readonly models: readonly TurnControlsValue["models"][number][]; readonly status: "ready" }
  | {
      readonly error: string;
      readonly models: readonly TurnControlsValue["models"][number][];
      readonly status: "error";
    };

/** Stable model-owned resource exposed to settings composition. */
export type VoiceAssistantModelCatalog = {
  readonly refresh: () => Promise<void>;
  readonly snapshot$: Observable<{ value: VoiceAssistantModelCatalogSnapshot }>;
};

/** Model-owned resource for the Voice Assistant picker; RPC data never lives in component state. */
export function createVoiceAssistantModelCatalog(
  load: () => Promise<readonly TurnControlsValue["models"][number][]>,
): VoiceAssistantModelCatalog {
  const initialSnapshot: VoiceAssistantModelCatalogSnapshot = { models: [], status: "idle" };
  const snapshot$ = observable<{ value: VoiceAssistantModelCatalogSnapshot }>({
    value: initialSnapshot,
  });
  let pending: Promise<void> | null = null;
  return {
    async refresh() {
      if (pending !== null) {
        return pending;
      }
      const current = snapshot$.value.peek();
      snapshot$.value.set({ models: current.models, status: "loading" });
      pending = load()
        .then((models) => {
          snapshot$.value.set({ models, status: "ready" });
        })
        .catch((error: unknown) => {
          snapshot$.value.set({
            error: error instanceof Error ? error.message : "Could not load available models",
            models: current.models,
            status: "error",
          });
        })
        .finally(() => {
          pending = null;
        });
      return pending;
    },
    snapshot$,
  };
}
