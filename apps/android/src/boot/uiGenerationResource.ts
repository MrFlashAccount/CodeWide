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
  return () => listeners.delete(listener);
}

export function loadUiGeneration(): void {
  if (loading !== null || snapshot.status !== "loading") return;
  loading = readUiGeneration()
    .then((generation) => publish({ status: "ready", generation }))
    .catch(() => publish({ status: "error", message: "Could not read UI generation" }));
}

export async function selectUiGeneration(generation: UiGeneration): Promise<void> {
  await writeUiGeneration(generation);
  publish({ status: "ready", generation });
}

function publish(next: UiGenerationSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}
