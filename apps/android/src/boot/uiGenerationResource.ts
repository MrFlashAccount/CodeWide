import { readUiGeneration, writeUiGeneration } from "./uiGenerationStore";
import type { UiGeneration } from "./uiGeneration";

export type UiGenerationSnapshot =
  | { status: "loading" }
  | { status: "ready"; generation: UiGeneration }
  | { status: "error"; message: string };

let snapshot: UiGenerationSnapshot = { status: "loading" };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function uiGenerationSnapshot(): UiGenerationSnapshot {
  return snapshot;
}

export function subscribeUiGeneration(listener: () => void): () => void {
  listeners.add(listener);
  loadUiGeneration();
  return () => {
    listeners.delete(listener);
  };
}

function loadUiGeneration(): void {
  if (loading !== null || snapshot.status !== "loading") return;
  const pending = readUiGeneration().then(
    (generation) => {
      loading = null;
      publish({ status: "ready", generation });
    },
    () => {
      loading = null;
      publish({ status: "error", message: "Could not read UI generation" });
    },
  );
  loading = pending;
}

export function retryUiGeneration(): void {
  if (loading !== null) return;
  publish({ status: "loading" });
  loadUiGeneration();
}

export async function selectUiGeneration(generation: UiGeneration): Promise<void> {
  await writeUiGeneration(generation);
}

function publish(next: UiGenerationSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}
