import { useSyncExternalStore } from "react";

import {
  subscribeUiGeneration,
  uiGenerationSnapshot,
  type UiGenerationSnapshot,
} from "./uiGenerationResource";

/** Reads the durable UI choice and starts its one process-wide load when needed. */
export function useUiGenerationSnapshot(): UiGenerationSnapshot {
  const snapshot = useSyncExternalStore(
    subscribeUiGeneration,
    uiGenerationSnapshot,
    uiGenerationSnapshot,
  );
  return snapshot;
}
