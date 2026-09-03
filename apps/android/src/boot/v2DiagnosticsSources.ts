import { setStringAsync } from "expo-clipboard";

import {
  operationalMetricsSnapshot,
  resetOperationalMetrics,
  setOperationalDiagnosticsEnabled,
} from "../data/operational-metrics";
import {
  performanceExperimentSnapshot,
  resetPerformanceExperiments,
  setPerformanceExperiment,
  subscribePerformanceExperiments,
} from "../data/performance-experiments";
import {
  getThreadNavigationProfileSnapshot,
  subscribeThreadNavigationProfiles,
} from "../data/thread-navigation-metrics";
import {
  captureHermesHeapSnapshot,
  getPerformanceMetricsSnapshot,
  setPerformanceMonitoringEnabled,
  subscribePerformanceMetrics,
} from "../native/performance-metrics";
import {
  createDiagnosticsSource,
  createNavigationDiagnosticsSource,
  type DiagnosticsSourceAdapterInput,
} from "../v2/features/diagnostics/diagnosticsSourceAdapters";
import type { PerformanceExperimentId } from "../v2/features/diagnostics/diagnosticsTypes";

const EXPERIMENT_SETTLE_MS = 1100;
const EXPERIMENT_WINDOW_MS = 7000;
const EMPTY_SUBSCRIPTION = (): (() => void) => () => undefined;

const diagnosticsInput: DiagnosticsSourceAdapterInput = {
  async copy(snapshot) {
    await setStringAsync(JSON.stringify(snapshot, null, 2));
  },
  experiments: {
    reset: resetPerformanceExperiments,
    set: setPerformanceExperiment,
    snapshot: performanceExperimentSnapshot,
    subscribe: subscribePerformanceExperiments,
  },
  native: {
    reset: () => undefined,
    setEnabled: setPerformanceMonitoringEnabled,
    snapshot: getPerformanceMetricsSnapshot,
    subscribe: subscribePerformanceMetrics,
  },
  operational: {
    reset: resetOperationalMetrics,
    setEnabled: setOperationalDiagnosticsEnabled,
    snapshot: operationalMetricsSnapshot,
    subscribe: EMPTY_SUBSCRIPTION,
  },
  runExperiment,
};

export const v2PerformanceDiagnosticsSource = createDiagnosticsSource(diagnosticsInput);

export const v2NavigationDiagnosticsSource = createNavigationDiagnosticsSource({
  captureHeap: captureHermesHeapSnapshot,
  async copy(profile) {
    await setStringAsync(JSON.stringify(profile, null, 2));
  },
  profiles: {
    snapshot: getThreadNavigationProfileSnapshot,
    subscribe: subscribeThreadNavigationProfiles,
  },
});

async function runExperiment(id: PerformanceExperimentId): Promise<void> {
  const previous = performanceExperimentSnapshot()[id];
  try {
    setPerformanceExperiment(id, false);
    await delay(EXPERIMENT_SETTLE_MS + EXPERIMENT_WINDOW_MS);
    setPerformanceExperiment(id, true);
    await delay(EXPERIMENT_SETTLE_MS + EXPERIMENT_WINDOW_MS);
  } finally {
    setPerformanceExperiment(id, previous);
  }
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}
