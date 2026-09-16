import { NativeEventEmitter, NativeModules } from "react-native";
import { useSyncExternalStore } from "react";

import { setOperationalDiagnosticsEnabled } from "../data/operational-metrics";
import { resetPerformanceExperiments } from "../data/performance-experiments";
import { setTelemetryEnabled } from "../data/telemetry";
import type { ThreadNavigationFrameProfile } from "../data/thread-navigation-metrics";
import { startFrameIncidentReporting } from "./frame-incidents.native";
import { parseWindowFrameReport, type WindowFrameReport } from "../data/window-frame-report";

export type PerformanceMetricPoint = {
  cpuPercent: number;
  jankPercent: number;
  p95FrameMs: number;
  pssBytes: number;
  renderedFps: number;
  rxBytesPerSecond: number;
  sampledAtMs: number;
  txBytesPerSecond: number;
};

export type CurrentPerformanceMetrics = PerformanceMetricPoint & {
  averageFrameMs: number;
  averageOverrunMs: number;
  codePssBytes: number;
  droppedFrameEstimate: number;
  graphicsPssBytes: number;
  jankFrames: number;
  javaHeapBytes: number;
  javaHeapLimitBytes: number;
  javaHeapPssBytes: number;
  maxFrameMs: number;
  nativeHeapBytes: number;
  nativeHeapPssBytes: number;
  privateOtherPssBytes: number;
  renderedFrames: number;
  rssBytes: number;
  rxSessionBytes: number;
  sequence: number;
  stackPssBytes: number;
  systemPssBytes: number;
  txSessionBytes: number;
  uptimeMs: number;
};

export type PerformanceMetricsSnapshot = {
  available: boolean;
  current: CurrentPerformanceMetrics | null;
  enabled: boolean;
  historyCapacity: number;
  historySamples: number;
  peakCpuPercent: number;
  peakPssBytes: number;
  recent: PerformanceMetricPoint[];
  samplePeriodMs: number;
  sessionJankPercent: number;
  totalDroppedFrameEstimate: number;
  totalFrames: number;
  totalJankFrames: number;
};

export type HermesHeapSnapshot = {
  collectedAtMs: number;
  location: string;
  name: string;
  rawSizeBytes: number;
  sizeBytes: number;
  uri: string;
};

export type MemoryCheckpoint = {
  artAllocatedBytes: number | null;
  artFreedBytes: number | null;
  captureDurationMs: number;
  collectedAtMs: number;
  errors: unknown[];
  graphicsPssBytes: number;
  javaCommittedBytes: number;
  javaHeapPssBytes: number;
  javaUsedBytes: number;
  nativeAllocatedBytes: number;
  nativeCommittedBytes: number;
  nativeFreeBytes: number;
  nativeHeapPssBytes: number;
  openFileDescriptors: number;
  privateOtherPssBytes: number;
  procRssBytes: number | null;
  smapsPssBytes: number | null;
  smapsRssBytes: number | null;
  smapsSwapPssBytes: number | null;
  threads: number;
  totalPssBytes: number;
  uptimeMs: number;
  version: number;
};

export type MemoryReclamationActionResult = {
  durationMs: number;
  performed: boolean;
};

type PerformanceBridge = {
  addListener: (eventName: string) => void;
  beginNavigationTrace?: (traceId: string) => Promise<boolean>;
  captureHermesHeapSnapshot?: () => Promise<HermesHeapSnapshot>;
  captureMemoryCheckpoint?: () => Promise<unknown>;
  captureMemoryReport?: () => Promise<unknown>;
  clearImageMemoryCache?: () => Promise<unknown>;
  clearNativeCodeMemoryCache?: () => Promise<unknown>;
  collectHermesGarbage?: () => Promise<unknown>;
  collectJavaGarbage?: () => Promise<unknown>;
  drainFrameIncidents?: () => Promise<unknown>;
  endNavigationTrace?: (traceId: string) => Promise<ThreadNavigationFrameProfile | null>;
  getPerformanceSnapshot: () => Promise<PerformanceMetricsSnapshot>;
  getWindowFrameReport?: () => Promise<unknown>;
  purgeNativeAllocator?: (exhaustive: boolean) => Promise<unknown>;
  removeListeners: (count: number) => void;
  setPerformanceMonitoringEnabled: (enabled: boolean) => Promise<PerformanceMetricsSnapshot>;
};

const EVENT_NAME = "CodexPerformanceSnapshot";
// WHY: React Native's untyped module registry is the runtime capability boundary for this
// optional native performance module; no generated declaration is available.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const bridge = NativeModules.CodexPerformanceNative as PerformanceBridge | undefined;
const emitter = bridge === undefined ? null : new NativeEventEmitter(bridge);
const listeners = new Set<() => void>();
let subscription: { remove: () => void } | null = null;
let loading: Promise<void> | null = null;
let snapshot: PerformanceMetricsSnapshot = {
  available: bridge !== undefined,
  current: null,
  enabled: false,
  historyCapacity: 3600,
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

function publish(next: PerformanceMetricsSnapshot): void {
  snapshot = next;
  setOperationalDiagnosticsEnabled(next.enabled);
  setTelemetryEnabled(next.enabled);
  listeners.forEach((listener) => {
    listener();
  });
}

function ensureNativeSubscription(): void {
  if (bridge === undefined || emitter === null) {
    return;
  }
  if (subscription === null) {
    subscription = emitter.addListener(EVENT_NAME, (next: PerformanceMetricsSnapshot) => {
      publish(next);
    });
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
  startFrameIncidentReporting({
    drainFrameIncidents: async () => drainFrameIncidents.call(bridge),
  });
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
  if (bridge === undefined) {
    return;
  }
  const next = await bridge.setPerformanceMonitoringEnabled(enabled);
  if (!next.enabled) {
    resetPerformanceExperiments();
  }
  publish(next);
}

export async function beginNavigationFrameTrace(traceId: string): Promise<boolean> {
  if (
    bridge === undefined ||
    !snapshot.enabled ||
    typeof bridge.beginNavigationTrace !== "function"
  ) {
    return false;
  }
  return bridge.beginNavigationTrace(traceId).catch(() => false);
}

export async function endNavigationFrameTrace(
  traceId: string,
): Promise<ThreadNavigationFrameProfile | null> {
  if (bridge === undefined || typeof bridge.endNavigationTrace !== "function") {
    return null;
  }
  return bridge.endNavigationTrace(traceId).catch(() => null);
}

export async function captureHermesHeapSnapshot(): Promise<HermesHeapSnapshot> {
  if (bridge === undefined || typeof bridge.captureHermesHeapSnapshot !== "function") {
    throw new Error("Hermes heap capture requires a newer Android APK");
  }
  return bridge.captureHermesHeapSnapshot();
}

const MAX_MEMORY_REPORT_CHARACTERS = 512 * 1024;

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
  if (bridge?.captureMemoryCheckpoint === undefined) {
    throw new Error("Memory experiment requires a newer Android APK");
  }
  const encoded = await bridge.captureMemoryCheckpoint();
  if (typeof encoded !== "string" || encoded.length === 0 || encoded.length > 64 * 1024) {
    throw new Error("Android returned an invalid memory checkpoint");
  }
  const parsed: unknown = JSON.parse(encoded);
  if (!isMemoryCheckpoint(parsed)) {
    throw new Error("Android returned an invalid memory checkpoint");
  }
  return parsed;
}

export async function clearNativeCodeMemoryCache(): Promise<MemoryReclamationActionResult> {
  if (bridge?.clearNativeCodeMemoryCache === undefined) {
    throw new Error("Memory experiment requires a newer Android APK");
  }
  return parseMemoryActionResult(await bridge.clearNativeCodeMemoryCache());
}

export async function clearImageMemoryCache(): Promise<MemoryReclamationActionResult> {
  if (bridge?.clearImageMemoryCache === undefined) {
    throw new Error("Memory experiment requires a newer Android APK");
  }
  return parseMemoryActionResult(await bridge.clearImageMemoryCache());
}

export async function collectJavaGarbage(): Promise<MemoryReclamationActionResult> {
  if (bridge?.collectJavaGarbage === undefined) {
    throw new Error("Memory experiment requires a newer Android APK");
  }
  return parseMemoryActionResult(await bridge.collectJavaGarbage());
}

export async function collectHermesGarbage(): Promise<MemoryReclamationActionResult> {
  if (bridge?.collectHermesGarbage === undefined) {
    throw new Error("Memory experiment requires a newer Android APK");
  }
  return parseMemoryActionResult(await bridge.collectHermesGarbage());
}

export async function purgeNativeAllocator(
  exhaustive: boolean,
): Promise<MemoryReclamationActionResult> {
  if (bridge?.purgeNativeAllocator === undefined) {
    throw new Error("Memory experiment requires a newer Android APK");
  }
  return parseMemoryActionResult(await bridge.purgeNativeAllocator(exhaustive));
}

function isMemoryCheckpoint(value: unknown): value is MemoryCheckpoint {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
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
  if (!requiredNumbers.every((key) => typeof Reflect.get(value, key) === "number")) {
    return false;
  }
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
      const field: unknown = Reflect.get(value, key);
      return field === null || typeof field === "number";
    })
  ) {
    return false;
  }
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
    durationMs: Number(Reflect.get(value, "durationMs")),
    performed: Reflect.get(value, "performed") === true,
  };
}

export async function getWindowFrameReport(): Promise<WindowFrameReport | null> {
  if (bridge?.getWindowFrameReport === undefined) {
    return null;
  }
  return parseWindowFrameReport(await bridge.getWindowFrameReport());
}
