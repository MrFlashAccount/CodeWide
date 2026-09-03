import type {
  DiagnosticsSource,
  NavigationDiagnosticsSource,
  NavigationProfile,
  NavigationProfilesSnapshot,
  OperationalMetricsSnapshot,
  PerformanceDiagnosticsSnapshot,
  PerformanceExperimentId,
  PerformanceExperimentSnapshot,
  PerformanceMetricsSnapshot,
} from "./diagnosticsTypes";

interface ObservableDiagnosticsSnapshot<Value> {
  snapshot(): Value;
  subscribe(listener: () => void): () => void;
}

interface PerformanceMetricsDiagnosticsPort extends ObservableDiagnosticsSnapshot<PerformanceMetricsSnapshot> {
  reset(): void;
  setEnabled(enabled: boolean): Promise<void>;
}

interface OperationalDiagnosticsPort extends ObservableDiagnosticsSnapshot<OperationalMetricsSnapshot> {
  reset(): void;
  setEnabled(enabled: boolean): void;
}

interface ExperimentDiagnosticsPort extends ObservableDiagnosticsSnapshot<PerformanceExperimentSnapshot> {
  reset(): void;
  set(id: PerformanceExperimentId, enabled: boolean): void;
}

export interface DiagnosticsSourceAdapterInput {
  copy(snapshot: PerformanceDiagnosticsSnapshot): Promise<void>;
  experiments: ExperimentDiagnosticsPort;
  native: PerformanceMetricsDiagnosticsPort;
  operational: OperationalDiagnosticsPort;
  runExperiment(id: PerformanceExperimentId): Promise<void>;
}

export interface NavigationDiagnosticsSourceAdapterInput {
  captureHeap: NavigationDiagnosticsSource["captureHeap"];
  copy(profile: NavigationProfile): Promise<void>;
  profiles: ObservableDiagnosticsSnapshot<NavigationProfilesSnapshot>;
}

/** Joins V2-owned telemetry ports into the stable snapshot expected by React. */
export function createDiagnosticsSource(input: DiagnosticsSourceAdapterInput): DiagnosticsSource {
  let current = combinedSnapshot(input);
  const listeners = new Set<() => void>();
  let stopUpstream: (() => void) | null = null;
  const publish = (): void => {
    current = combinedSnapshot(input);
    for (const listener of listeners) listener();
  };
  return {
    copySnapshot: () => input.copy(current),
    reset(): void {
      input.native.reset();
      input.operational.reset();
    },
    runExperiment: input.runExperiment,
    setExperiment: input.experiments.set,
    async setMonitoringEnabled(enabled): Promise<void> {
      await input.native.setEnabled(enabled);
      input.operational.setEnabled(enabled);
      if (!enabled) input.experiments.reset();
    },
    snapshot: () => current,
    subscribe(listener): () => void {
      if (listeners.size === 0) {
        current = combinedSnapshot(input);
        const unsubscribers = [
          input.experiments.subscribe(publish),
          input.native.subscribe(publish),
          input.operational.subscribe(publish),
        ];
        stopUpstream = () => {
          for (const unsubscribe of unsubscribers) unsubscribe();
        };
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stopUpstream?.();
          stopUpstream = null;
        }
      };
    },
  };
}

export function createNavigationDiagnosticsSource(
  input: NavigationDiagnosticsSourceAdapterInput,
): NavigationDiagnosticsSource {
  return {
    captureHeap: input.captureHeap,
    copyReport: input.copy,
    snapshot: input.profiles.snapshot,
    subscribe: input.profiles.subscribe,
  };
}

function combinedSnapshot(input: DiagnosticsSourceAdapterInput): PerformanceDiagnosticsSnapshot {
  return {
    experiments: input.experiments.snapshot(),
    native: input.native.snapshot(),
    operational: input.operational.snapshot(),
  };
}
