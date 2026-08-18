import { NativeEventEmitter, NativeModules } from "react-native";
import { useSyncExternalStore } from "react";

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

type PerformanceBridge = {
  getPerformanceSnapshot(): Promise<PerformanceMetricsSnapshot>;
  setPerformanceMonitoringEnabled(enabled: boolean): Promise<PerformanceMetricsSnapshot>;
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

export async function setPerformanceMonitoringEnabled(enabled: boolean): Promise<void> {
  if (bridge === undefined) return;
  publish(await bridge.setPerformanceMonitoringEnabled(enabled));
}
