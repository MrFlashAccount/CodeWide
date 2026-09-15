import { NativeEventEmitter, NativeModules } from "react-native";
import { useSyncExternalStore } from "react";

import { setOperationalDiagnosticsEnabled } from "../data/operational-metrics";
import { resetPerformanceExperiments } from "../data/performance-experiments";
import { setTelemetryEnabled } from "../data/telemetry";
import type { ThreadNavigationFrameProfile } from "../data/thread-navigation-metrics";
import { startFrameIncidentReporting } from "./frame-incidents.native";
import { parseWindowFrameReport, type WindowFrameReport } from "../data/window-frame-report";

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

export type MemoryCheckpoint = {
  version: number;
  collectedAtMs: number;
  uptimeMs: number;
  captureDurationMs: number;
  javaUsedBytes: number;
  javaCommittedBytes: number;
  nativeAllocatedBytes: number;
  nativeCommittedBytes: number;
  nativeFreeBytes: number;
  totalPssBytes: number;
  javaHeapPssBytes: number;
  nativeHeapPssBytes: number;
  graphicsPssBytes: number;
  privateOtherPssBytes: number;
  procRssBytes: number | null;
  smapsPssBytes: number | null;
  smapsRssBytes: number | null;
  smapsSwapPssBytes: number | null;
  artAllocatedBytes: number | null;
  artFreedBytes: number | null;
  openFileDescriptors: number;
  threads: number;
  errors: unknown[];
};

export type MemoryReclamationActionResult = {
  performed: boolean;
  durationMs: number;
};

type PerformanceBridge = {
  getWindowFrameReport?(): Promise<unknown>;
  drainFrameIncidents?(): Promise<unknown>;
  captureMemoryReport?(): Promise<unknown>;
  captureMemoryCheckpoint?(): Promise<unknown>;
  clearNativeCodeMemoryCache?(): Promise<unknown>;
  clearImageMemoryCache?(): Promise<unknown>;
  collectJavaGarbage?(): Promise<unknown>;
  collectHermesGarbage?(): Promise<unknown>;
  purgeNativeAllocator?(exhaustive: boolean): Promise<unknown>;
  getPerformanceSnapshot(): Promise<PerformanceMetricsSnapshot>;
  setPerformanceMonitoringEnabled(enabled: boolean): Promise<PerformanceMetricsSnapshot>;
  beginNavigationTrace?(traceId: string): Promise<boolean>;
  endNavigationTrace?(traceId: string): Promise<ThreadNavigationFrameProfile | null>;
  captureHermesHeapSnapshot?(): Promise<HermesHeapSnapshot>;
};

const EVENT_NAME = "CodexPerformanceSnapshot";
const bridge = NativeModules.CodexPerformanceNative as PerformanceBridge | undefined;
const emitter =
  bridge === undefined ? null : new NativeEventEmitter(NativeModules.CodexPerformanceNative);
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
    subscription = emitter.addListener(EVENT_NAME, (next: PerformanceMetricsSnapshot) =>
      publish(next),
    );
  }
  if (loading === null) {
    loading = bridge
      .getPerformanceSnapshot()
      .then(publish)
      .catch(() => undefined)
      .finally(() => {
        loading = null;
      });
  }
}

// Restore the persisted Data for geeks state during app bootstrap. Navigation
// may happen before Settings is ever opened, so diagnostics cannot be lazily
// enabled by the settings screen itself.
ensureNativeSubscription();
const drainFrameIncidents = bridge?.drainFrameIncidents;
if (typeof drainFrameIncidents === "function") {
  startFrameIncidentReporting({ drainFrameIncidents: () => drainFrameIncidents.call(bridge) });
}

export function subscribePerformanceMetrics(listener: () => void): () => void {
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
  return useSyncExternalStore(
    subscribePerformanceMetrics,
    () => snapshot,
    () => snapshot,
  );
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
  if (
    bridge === undefined ||
    !snapshot.enabled ||
    typeof bridge.beginNavigationTrace !== "function"
  )
    return false;
  return await bridge.beginNavigationTrace(traceId).catch(() => false);
}

export async function endNavigationFrameTrace(
  traceId: string,
): Promise<ThreadNavigationFrameProfile | null> {
  if (bridge === undefined || typeof bridge.endNavigationTrace !== "function") return null;
  return await bridge.endNavigationTrace(traceId).catch(() => null);
}

export async function captureHermesHeapSnapshot(): Promise<HermesHeapSnapshot> {
  if (bridge === undefined || typeof bridge.captureHermesHeapSnapshot !== "function") {
    throw new Error("Hermes heap capture requires a newer Android APK");
  }
  return await bridge.captureHermesHeapSnapshot();
}

const MAX_MEMORY_REPORT_CHARACTERS = 512 * 1_024;

export async function captureMemoryReport(): Promise<string> {
  if (bridge === undefined || typeof bridge.captureMemoryReport !== "function") {
    throw new Error("Memory report requires a newer Android APK");
  }
  const report = await bridge.captureMemoryReport();
  if (
    typeof report !== "string" ||
    report.length === 0 ||
    report.length > MAX_MEMORY_REPORT_CHARACTERS
  ) {
    throw new Error("Android returned an invalid memory report");
  }
  const parsed: unknown = JSON.parse(report);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Android returned an invalid memory report");
  }
  return report;
}

export function memoryReclamationExperimentAvailable(): boolean {
  return (
    bridge?.captureMemoryCheckpoint !== undefined &&
    bridge.clearNativeCodeMemoryCache !== undefined &&
    bridge.clearImageMemoryCache !== undefined &&
    bridge.collectJavaGarbage !== undefined &&
    bridge.collectHermesGarbage !== undefined &&
    bridge.purgeNativeAllocator !== undefined
  );
}

export async function captureMemoryCheckpoint(): Promise<MemoryCheckpoint> {
  if (bridge?.captureMemoryCheckpoint === undefined)
    throw new Error("Memory experiment requires a newer Android APK");
  const encoded = await bridge.captureMemoryCheckpoint();
  if (typeof encoded !== "string" || encoded.length === 0 || encoded.length > 64 * 1_024) {
    throw new Error("Android returned an invalid memory checkpoint");
  }
  const parsed: unknown = JSON.parse(encoded);
  if (!isMemoryCheckpoint(parsed)) throw new Error("Android returned an invalid memory checkpoint");
  return parsed;
}

export async function clearNativeCodeMemoryCache(): Promise<MemoryReclamationActionResult> {
  if (bridge?.clearNativeCodeMemoryCache === undefined)
    throw new Error("Memory experiment requires a newer Android APK");
  return parseMemoryActionResult(await bridge.clearNativeCodeMemoryCache());
}

export async function clearImageMemoryCache(): Promise<MemoryReclamationActionResult> {
  if (bridge?.clearImageMemoryCache === undefined)
    throw new Error("Memory experiment requires a newer Android APK");
  return parseMemoryActionResult(await bridge.clearImageMemoryCache());
}

export async function collectJavaGarbage(): Promise<MemoryReclamationActionResult> {
  if (bridge?.collectJavaGarbage === undefined)
    throw new Error("Memory experiment requires a newer Android APK");
  return parseMemoryActionResult(await bridge.collectJavaGarbage());
}

export async function collectHermesGarbage(): Promise<MemoryReclamationActionResult> {
  if (bridge?.collectHermesGarbage === undefined)
    throw new Error("Memory experiment requires a newer Android APK");
  return parseMemoryActionResult(await bridge.collectHermesGarbage());
}

export async function purgeNativeAllocator(
  exhaustive: boolean,
): Promise<MemoryReclamationActionResult> {
  if (bridge?.purgeNativeAllocator === undefined)
    throw new Error("Memory experiment requires a newer Android APK");
  return parseMemoryActionResult(await bridge.purgeNativeAllocator(exhaustive));
}

function isMemoryCheckpoint(value: unknown): value is MemoryCheckpoint {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const requiredNumbers = [
    "version",
    "collectedAtMs",
    "uptimeMs",
    "captureDurationMs",
    "javaUsedBytes",
    "javaCommittedBytes",
    "nativeAllocatedBytes",
    "nativeCommittedBytes",
    "nativeFreeBytes",
    "totalPssBytes",
    "javaHeapPssBytes",
    "nativeHeapPssBytes",
    "graphicsPssBytes",
    "privateOtherPssBytes",
    "openFileDescriptors",
    "threads",
  ];
  if (!requiredNumbers.every((key) => typeof Reflect.get(value, key) === "number")) return false;
  const nullableNumbers = [
    "procRssBytes",
    "smapsPssBytes",
    "smapsRssBytes",
    "smapsSwapPssBytes",
    "artAllocatedBytes",
    "artFreedBytes",
  ];
  if (
    !nullableNumbers.every((key) => {
      const field = Reflect.get(value, key);
      return field === null || typeof field === "number";
    })
  )
    return false;
  return Array.isArray(Reflect.get(value, "errors"));
}

function parseMemoryActionResult(value: unknown): MemoryReclamationActionResult {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof Reflect.get(value, "performed") !== "boolean" ||
    typeof Reflect.get(value, "durationMs") !== "number"
  ) {
    throw new Error("Android returned an invalid memory action result");
  }
  return {
    performed: Reflect.get(value, "performed") === true,
    durationMs: Number(Reflect.get(value, "durationMs")),
  };
}

export async function getWindowFrameReport(): Promise<WindowFrameReport | null> {
  if (bridge?.getWindowFrameReport === undefined) return null;
  return parseWindowFrameReport(await bridge.getWindowFrameReport());
}
