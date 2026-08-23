import { NativeEventEmitter, NativeModules } from "react-native";
import { useSyncExternalStore } from "react";

import { setOperationalDiagnosticsEnabled } from "../data/operational-metrics";
import { resetPerformanceExperiments } from "../data/performance-experiments";
import { setTelemetryEnabled } from "../data/telemetry";
import type { ThreadNavigationFrameProfile } from "../data/thread-navigation-metrics";

export type PerformanceMetricPoint = {
  sampledAtMs: number;
  cpuPercent: number;
  pssBytes: number;
  renderedFps: number;
  p95FrameMs: number;
  jankPercent: number;
  rxBytesPerSecond: number;
  txBytesPerSecond: number;
};

export type CurrentPerformanceMetrics = PerformanceMetricPoint & {
  sequence: number;
  uptimeMs: number;
  rssBytes: number;
  javaHeapBytes: number;
  javaHeapLimitBytes: number;
  nativeHeapBytes: number;
  javaHeapPssBytes: number;
  nativeHeapPssBytes: number;
  codePssBytes: number;
  stackPssBytes: number;
  graphicsPssBytes: number;
  privateOtherPssBytes: number;
  systemPssBytes: number;
  rxSessionBytes: number;
  txSessionBytes: number;
  renderedFrames: number;
  averageFrameMs: number;
  maxFrameMs: number;
  jankFrames: number;
  droppedFrameEstimate: number;
  averageOverrunMs: number;
};

export type PerformanceMetricsSnapshot = {
  available: boolean;
  enabled: boolean;
  samplePeriodMs: number;
  historyCapacity: number;
  historySamples: number;
  peakCpuPercent: number;
  peakPssBytes: number;
  totalFrames: number;
  totalJankFrames: number;
  totalDroppedFrameEstimate: number;
  sessionJankPercent: number;
  current: CurrentPerformanceMetrics | null;
  recent: PerformanceMetricPoint[];
};

export type HermesHeapSnapshot = {
  uri: string;
  name: string;
  sizeBytes: number;
  rawSizeBytes: number;
  collectedAtMs: number;
  location: string;
};

type PerformanceBridge = {
  getPerformanceSnapshot(): Promise<PerformanceMetricsSnapshot>;
  setPerformanceMonitoringEnabled(enabled: boolean): Promise<PerformanceMetricsSnapshot>;
  beginNavigationTrace?(traceId: string): Promise<boolean>;
  endNavigationTrace?(traceId: string): Promise<ThreadNavigationFrameProfile | null>;
  captureHermesHeapSnapshot?(): Promise<HermesHeapSnapshot>;
};

const EVENT_NAME = "CodexPerformanceSnapshot";
const bridge = NativeModules.CodexPerformanceNative as PerformanceBridge | undefined;
const emitter = bridge === undefined ? null : new NativeEventEmitter(NativeModules.CodexPerformanceNative);
const listeners = new Set<() => void>();
let subscription: { remove(): void } | null = null;
let loading: Promise<void> | null = null;
let snapshot: PerformanceMetricsSnapshot = {
  available: bridge !== undefined,
  enabled: false,
  samplePeriodMs: 1_000,
  historyCapacity: 3_600,
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

function publish(next: PerformanceMetricsSnapshot): void {
  snapshot = next;
  setOperationalDiagnosticsEnabled(next.enabled);
  setTelemetryEnabled(next.enabled);
  listeners.forEach((listener) => listener());
}

function ensureNativeSubscription(): void {
  if (bridge === undefined || emitter === null) return;
  if (subscription === null) {
    subscription = emitter.addListener(EVENT_NAME, (next: PerformanceMetricsSnapshot) => publish(next));
  }
  if (loading === null) {
    loading = bridge.getPerformanceSnapshot()
      .then(publish)
      .catch(() => undefined)
      .finally(() => { loading = null; });
  }
}

// Restore the persisted Data for geeks state during app bootstrap. Navigation
// may happen before Settings is ever opened, so diagnostics cannot be lazily
// enabled by the settings screen itself.
ensureNativeSubscription();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  ensureNativeSubscription();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      subscription?.remove();
      subscription = null;
    }
  };
}

export function usePerformanceMetrics(): PerformanceMetricsSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

export function getPerformanceMetricsSnapshot(): PerformanceMetricsSnapshot {
  return snapshot;
}

export async function setPerformanceMonitoringEnabled(enabled: boolean): Promise<void> {
  if (bridge === undefined) return;
  const next = await bridge.setPerformanceMonitoringEnabled(enabled);
  if (!next.enabled) resetPerformanceExperiments();
  publish(next);
}

export async function beginNavigationFrameTrace(traceId: string): Promise<boolean> {
  if (bridge === undefined || !snapshot.enabled || typeof bridge.beginNavigationTrace !== "function") return false;
  return await bridge.beginNavigationTrace(traceId).catch(() => false);
}

export async function endNavigationFrameTrace(traceId: string): Promise<ThreadNavigationFrameProfile | null> {
  if (bridge === undefined || typeof bridge.endNavigationTrace !== "function") return null;
  return await bridge.endNavigationTrace(traceId).catch(() => null);
}

export async function captureHermesHeapSnapshot(): Promise<HermesHeapSnapshot> {
  if (bridge === undefined || typeof bridge.captureHermesHeapSnapshot !== "function") {
    throw new Error("Hermes heap capture requires a newer Android APK");
  }
  return await bridge.captureHermesHeapSnapshot();
}
