import { useSyncExternalStore } from "react";

import type { PerformanceMetricsSnapshot } from "./performance-metrics.native";

const snapshot: PerformanceMetricsSnapshot = {
  available: false,
  enabled: false,
  samplePeriodMs: 1_000,
  historyCapacity: 0,
  historySamples: 0,
  peakCpuPercent: 0,
  peakPssBytes: 0,
  totalFrames: 0,
  totalJankFrames: 0,
  totalDroppedFrameEstimate: 0,
  sessionJankPercent: 0,
  current: null,
  recent: [],
};

const subscribe = () => () => {};

export function usePerformanceMetrics(): PerformanceMetricsSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

export async function setPerformanceMonitoringEnabled(_enabled: boolean): Promise<void> {}

export type { PerformanceMetricsSnapshot } from "./performance-metrics.native";
