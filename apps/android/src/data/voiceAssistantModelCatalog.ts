import { observable, type Observable } from "@legendapp/state";

import type { TurnControlsValue } from "./turn-controls-types";
import { primaryProviderModels } from "./turnControlsAgentProviders";

type VoiceAssistantModel = TurnControlsValue["models"][number];

/**
 * Published state for the Voice Assistant view of the shared model catalog. The
 * models always belong to `connectionId` (the server that runs the Voice
 * Assistant); `null` before any server was resolved.
 */
export type VoiceAssistantModelCatalogSnapshot =
  | {
      readonly connectionId: string | null;
      readonly models: readonly VoiceAssistantModel[];
      readonly status: "idle";
    }
  | {
      readonly connectionId: string | null;
      readonly models: readonly VoiceAssistantModel[];
      readonly status: "loading";
    }
  | {
      readonly connectionId: string;
      readonly models: readonly VoiceAssistantModel[];
      readonly status: "ready";
    }
  | {
      readonly connectionId: string | null;
      readonly error: string;
      readonly models: readonly VoiceAssistantModel[];
      readonly status: "error";
    };

/** Stable model-owned resource exposed to settings composition. */
export type VoiceAssistantModelCatalog = {
  readonly refresh: () => Promise<void>;
  readonly snapshot$: Observable<{ value: VoiceAssistantModelCatalogSnapshot }>;
};

/**
 * Model-owned resource for the Voice Assistant picker; RPC data never lives in component state.
 * The hidden supervisor thread runs on the host's primary provider, so only its models are offered.
 * The snapshot is keyed by the server: a refresh for another server never shows, and a failed
 * refresh never keeps, the previous server's models.
 */
export function createVoiceAssistantModelCatalog(
  resolveConnectionId: () => Promise<string>,
  load: (connectionId: string) => Promise<readonly VoiceAssistantModel[]>,
): VoiceAssistantModelCatalog {
  const initialSnapshot: VoiceAssistantModelCatalogSnapshot = {
    connectionId: null,
    models: [],
    status: "idle",
  };
  const snapshot$ = observable<{ value: VoiceAssistantModelCatalogSnapshot }>({
    value: initialSnapshot,
  });
  const failed =
    (connectionId: string | null, models: readonly VoiceAssistantModel[]) =>
    (error: unknown): void => {
      snapshot$.value.set({
        connectionId,
        error: error instanceof Error ? error.message : "Could not load available models",
        models,
        status: "error",
      });
    };
  const refreshOnce = async (): Promise<void> => {
    const current = snapshot$.value.peek();
    snapshot$.value.set({
      connectionId: current.connectionId,
      models: current.models,
      status: "loading",
    });
    let connectionId: string;
    try {
      connectionId = await resolveConnectionId();
    } catch (error) {
      failed(null, [])(error);
      return;
    }
    const sameServer = current.connectionId === connectionId;
    const carried = sameServer ? current.models : [];
    if (!sameServer) {
      snapshot$.value.set({ connectionId, models: carried, status: "loading" });
    }
    try {
      const models = await load(connectionId);
      snapshot$.value.set({ connectionId, models: primaryProviderModels(models), status: "ready" });
    } catch (error) {
      failed(connectionId, carried)(error);
    }
  };
  let pending: Promise<void> | null = null;
  return {
    async refresh() {
      if (pending !== null) {
        return pending;
      }
      pending = refreshOnce().finally(() => {
        pending = null;
      });
      return pending;
    },
    snapshot$,
  };
}
