import { useSyncExternalStore } from "react";

import type { HermesHeapSnapshot, PerformanceMetricsSnapshot } from "./performance-metrics.native";
import type { ThreadNavigationFrameProfile } from "../data/thread-navigation-metrics";

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

export function getPerformanceMetricsSnapshot(): PerformanceMetricsSnapshot {
  return snapshot;
}

export async function setPerformanceMonitoringEnabled(_enabled: boolean): Promise<void> {}

export async function beginNavigationFrameTrace(_traceId: string): Promise<boolean> {
  return false;
}

export async function endNavigationFrameTrace(_traceId: string): Promise<ThreadNavigationFrameProfile | null> {
  return null;
}

export async function captureHermesHeapSnapshot(): Promise<HermesHeapSnapshot> {
  throw new Error("Hermes heap capture is available only in the Android app");
}

export type { PerformanceMetricsSnapshot } from "./performance-metrics.native";
