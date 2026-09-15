import { useSyncExternalStore } from "react";
import type { WindowFrameReport } from "../data/window-frame-report";

import type {
  HermesHeapSnapshot,
  MemoryCheckpoint,
  MemoryReclamationActionResult,
  PerformanceMetricsSnapshot,
} from "./performance-metrics.native";
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

export function subscribePerformanceMetrics(_listener: () => void): () => void {
  return () => undefined;
}

export function usePerformanceMetrics(): PerformanceMetricsSnapshot {
  return useSyncExternalStore(
    subscribePerformanceMetrics,
    () => snapshot,
    () => snapshot,
  );
}

export function getPerformanceMetricsSnapshot(): PerformanceMetricsSnapshot {
  return snapshot;
}

export async function setPerformanceMonitoringEnabled(_enabled: boolean): Promise<void> {}

export async function getWindowFrameReport(): Promise<WindowFrameReport | null> {
  return null;
}

export async function beginNavigationFrameTrace(_traceId: string): Promise<boolean> {
  return false;
}

export async function endNavigationFrameTrace(
  _traceId: string,
): Promise<ThreadNavigationFrameProfile | null> {
  return null;
}

export async function captureHermesHeapSnapshot(): Promise<HermesHeapSnapshot> {
  throw new Error("Hermes heap capture is available only in the Android app");
}

export async function captureMemoryReport(): Promise<string> {
  throw new Error("Memory report is available only in the Android app");
}

export function memoryReclamationExperimentAvailable(): boolean {
  return false;
}

export async function captureMemoryCheckpoint(): Promise<MemoryCheckpoint> {
  throw new Error("Memory experiment is available only in the Android app");
}

export async function clearNativeCodeMemoryCache(): Promise<MemoryReclamationActionResult> {
  throw new Error("Memory experiment is available only in the Android app");
}

export async function clearImageMemoryCache(): Promise<MemoryReclamationActionResult> {
  throw new Error("Memory experiment is available only in the Android app");
}

export async function collectJavaGarbage(): Promise<MemoryReclamationActionResult> {
  throw new Error("Memory experiment is available only in the Android app");
}

export async function collectHermesGarbage(): Promise<MemoryReclamationActionResult> {
  throw new Error("Memory experiment is available only in the Android app");
}

export async function purgeNativeAllocator(
  _exhaustive: boolean,
): Promise<MemoryReclamationActionResult> {
  throw new Error("Memory experiment is available only in the Android app");
}

export type {
  HermesHeapSnapshot,
  MemoryCheckpoint,
  MemoryReclamationActionResult,
  PerformanceMetricPoint,
  PerformanceMetricsSnapshot,
} from "./performance-metrics.native";
