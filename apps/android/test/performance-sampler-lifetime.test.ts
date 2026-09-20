import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const nativeModule = readFileSync(
  new URL(
    "../android/app/src/main/java/dev/codewide/app/performance/CodexPerformanceModule.kt",
    import.meta.url,
  ),
  "utf8",
);
const bridge = readFileSync(
  new URL("../src/native/performance-metrics.native.ts", import.meta.url),
  "utf8",
);
const hudLayout = readFileSync(
  new URL("../src/features/diagnostics/navigationPerformanceHudLayout.ts", import.meta.url),
  "utf8",
);

describe("performance sampler lifetime", () => {
  it("keeps frame and CPU sampling frequent without walking process memory every second", () => {
    expect(nativeModule).toContain("private const val SAMPLE_PERIOD_MS = 1_000L");
    expect(nativeModule).toContain("private const val MEMORY_SAMPLE_PERIOD_MS = 60_000L");
    expect(nativeModule).toContain("private const val HISTORY_CAPACITY = 60");
    expect(nativeModule).toContain("if (!enabled || !foreground) return");
    expect(nativeModule).toContain("if (cached != null && elapsedMs < nextMemorySampleElapsedMs)");
    expect(nativeModule).toContain(
      "nextMemorySampleElapsedMs = elapsedMs + MEMORY_SAMPLE_PERIOD_MS",
    );
    expect(nativeModule).toContain('File("/proc/self/statm").readText()');
    expect(nativeModule).toContain("rssBytes = rssBytes");
    expect(nativeModule).toContain("snapshotMap(includeHistory = false)");
    expect(bridge).toContain("appendRecentMetric(snapshot.recent, current)");
  });

  it("runs Hermes sampling only after an explicit one-shot request", () => {
    expect(nativeModule).toContain("fun armNextNavigationHermesProfile(promise: Promise)");
    expect(nativeModule).toContain("if (!hermesNavigationCaptureArmed.getAndSet(false))");
    expect(nativeModule).toContain("HermesSamplingProfiler.enable()");
  });

  it("does not retain the native event bridge without a diagnostics consumer", () => {
    const bootstrap = bridge.slice(
      bridge.indexOf("loadNativeSnapshot();"),
      bridge.indexOf("export function subscribePerformanceMetrics"),
    );
    expect(bootstrap).not.toContain("emitter.addListener");
    expect(bridge).toContain("if (subscription === null && emitter !== null)");
    expect(bridge).toContain("if (listeners.size === 0)");
  });

  it("keeps heavyweight diagnostics outside the always-on overlay path", () => {
    expect(nativeModule).not.toContain("scheduleWithFixedDelay({ windowJournal.persist() }");
    expect(nativeModule).toContain("if (foreground && activeNavigationTrace != null)");
    expect(nativeModule).toContain("windowMonitor.start(context.currentActivity?.window)");
    expect(bridge).not.toContain("startFrameIncidentReporting");
    expect(bridge).not.toContain("setOperationalDiagnosticsEnabled(next.enabled)");
    expect(bridge).not.toContain("setTelemetryEnabled(next.enabled)");
    expect(hudLayout).toContain("usePerformanceMonitoringEnabled()");
    expect(hudLayout).not.toContain("usePerformanceMetrics()");
  });
});
