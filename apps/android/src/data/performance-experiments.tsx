import { createContext, type ReactNode, useContext, useSyncExternalStore } from "react";

export type PerformanceExperimentId =
  | "disableTextShimmer"
  | "hideThreadLists"
  | "plainTextMarkdown"
  | "skipMarkdownLayout"
  | "reduceCustomMotion";

export type PerformanceExperimentSnapshot = Readonly<Record<PerformanceExperimentId, boolean>>;

const DEFAULT_SNAPSHOT: PerformanceExperimentSnapshot = Object.freeze({
  disableTextShimmer: false,
  hideThreadLists: false,
  plainTextMarkdown: false,
  skipMarkdownLayout: false,
  reduceCustomMotion: false,
});

let snapshot = DEFAULT_SNAPSHOT;
const listeners = new Set<() => void>();
const PerformanceExperimentContext = createContext<PerformanceExperimentSnapshot>(DEFAULT_SNAPSHOT);

export function subscribePerformanceExperiments(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function performanceExperimentSnapshot(): PerformanceExperimentSnapshot {
  return snapshot;
}

export function performanceExperimentEnabled(id: PerformanceExperimentId): boolean {
  return snapshot[id];
}

export function setPerformanceExperiment(id: PerformanceExperimentId, enabled: boolean): void {
  if (snapshot[id] === enabled) return;
  snapshot = Object.freeze({ ...snapshot, [id]: enabled });
  listeners.forEach((listener) => listener());
}

export function resetPerformanceExperiments(): void {
  if (Object.values(snapshot).every((enabled) => !enabled)) return;
  snapshot = DEFAULT_SNAPSHOT;
  listeners.forEach((listener) => listener());
}

export function PerformanceExperimentProvider({ children }: { children: ReactNode }) {
  const value = useSyncExternalStore(subscribePerformanceExperiments, performanceExperimentSnapshot, performanceExperimentSnapshot);
  return <PerformanceExperimentContext.Provider value={value}>{children}</PerformanceExperimentContext.Provider>;
}

export function usePerformanceExperiments(): PerformanceExperimentSnapshot {
  return useContext(PerformanceExperimentContext);
}

export function usePerformanceExperiment(id: PerformanceExperimentId): boolean {
  return usePerformanceExperiments()[id];
}

export function resetPerformanceExperimentsForTests(): void {
  snapshot = DEFAULT_SNAPSHOT;
  listeners.clear();
}
