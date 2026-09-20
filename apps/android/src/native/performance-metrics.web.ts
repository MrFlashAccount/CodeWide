import { useSyncExternalStore } from "react";
import type { WindowFrameReport } from "../data/window-frame-report";

import type {
  HermesHeapSnapshot,
  MemoryCheckpoint,
  MemoryReclamationActionResult,
  PerformanceMetricsSnapshot,
  SavedNavigationProfile,
} from "./performance-metrics.native";
import type { ThreadNavigationFrameProfile } from "../data/thread-navigation-metrics";

const snapshot: PerformanceMetricsSnapshot = {
  available: false,
  current: null,
  enabled: false,
  historyCapacity: 0,
  historySamples: 0,
  peakCpuPercent: 0,
  peakPssBytes: 0,
  recent: [],
  samplePeriodMs: 1000,
  sessionJankPercent: 0,
  totalDroppedFrameEstimate: 0,
  totalFrames: 0,
  totalJankFrames: 0,
};

// WHY: Unsupported web diagnostics must reject asynchronously instead of throwing before callers receive a Promise.
// oxlint-disable-next-line typescript/require-await
async function androidOnly(message: string): Promise<never> {
  throw new Error(message);
}

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

export function usePerformanceMonitoringEnabled(): boolean {
  return false;
}

export function getPerformanceMetricsSnapshot(): PerformanceMetricsSnapshot {
  return snapshot;
}

export async function setPerformanceMonitoringEnabled(_enabled: boolean): Promise<void> {
  await Promise.resolve();
}

export async function getWindowFrameReport(): Promise<WindowFrameReport | null> {
  await Promise.resolve();
  return null;
}

export async function beginNavigationFrameTrace(_traceId: string): Promise<boolean> {
  await Promise.resolve();
  return false;
}

export async function armNextNavigationHermesProfile(): Promise<void> {
  await androidOnly("Hermes navigation profiling is available only in the Android app");
}

export async function endNavigationFrameTrace(
  _traceId: string,
): Promise<ThreadNavigationFrameProfile | null> {
  await Promise.resolve();
  return null;
}

export async function captureHermesHeapSnapshot(): Promise<HermesHeapSnapshot> {
  const unavailable = await androidOnly("Hermes heap capture is available only in the Android app");
  return unavailable;
}

export async function saveNavigationProfile(_report: string): Promise<SavedNavigationProfile> {
  const unavailable = await androidOnly(
    "Saving a navigation profile is available only in the Android app",
  );
  return unavailable;
}

export async function captureMemoryReport(): Promise<string> {
  const unavailable = await androidOnly("Memory report is available only in the Android app");
  return unavailable;
}

export function memoryReclamationExperimentAvailable(): boolean {
  return false;
}

export async function captureMemoryCheckpoint(): Promise<MemoryCheckpoint> {
  const unavailable = await androidOnly("Memory experiment is available only in the Android app");
  return unavailable;
}

export async function clearNativeCodeMemoryCache(): Promise<MemoryReclamationActionResult> {
  const unavailable = await androidOnly("Memory experiment is available only in the Android app");
  return unavailable;
}

export async function clearImageMemoryCache(): Promise<MemoryReclamationActionResult> {
  const unavailable = await androidOnly("Memory experiment is available only in the Android app");
  return unavailable;
}

export async function collectJavaGarbage(): Promise<MemoryReclamationActionResult> {
  const unavailable = await androidOnly("Memory experiment is available only in the Android app");
  return unavailable;
}

export async function collectHermesGarbage(): Promise<MemoryReclamationActionResult> {
  const unavailable = await androidOnly("Memory experiment is available only in the Android app");
  return unavailable;
}

export async function purgeNativeAllocator(
  _exhaustive: boolean,
): Promise<MemoryReclamationActionResult> {
  const unavailable = await androidOnly("Memory experiment is available only in the Android app");
  return unavailable;
}

export type {
  HermesHeapSnapshot,
  MemoryCheckpoint,
  MemoryReclamationActionResult,
  PerformanceMetricPoint,
  PerformanceMetricsSnapshot,
  SavedNavigationProfile,
} from "./performance-metrics.native";
