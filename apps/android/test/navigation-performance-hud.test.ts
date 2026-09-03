import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const hud = readFileSync(new URL("../src/ui/NavigationPerformanceHud.tsx", import.meta.url), "utf8");
const nativeRoot = readFileSync(new URL("../src/ui/HeroUIRoot.native.tsx", import.meta.url), "utf8");
const generationHost = readFileSync(
  new URL("../src/boot/UiGenerationDiagnosticsHost.tsx", import.meta.url),
  "utf8",
);
const screen = readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8");
const performanceModule = readFileSync(new URL("../android/app/src/main/java/dev/codewide/app/performance/CodexPerformanceModule.kt", import.meta.url), "utf8");

describe("navigation performance HUD", () => {
  it("profiles virtualized chat navigation without rendering message content", () => {
    expect(nativeRoot).not.toContain("<NavigationPerformanceHud />");
    expect(generationHost).toContain('props.generation === "legacy"');
    expect(generationHost).toContain('props.generation === "v2"');
    expect(generationHost).toContain("<LegacyNavigationPerformanceHud />");
    expect(generationHost).toContain("<NavigationDiagnosticsFeature");
    expect(hud).toContain("if (!metrics.enabled) return null");
    expect(hud).toContain('testID="navigation-performance-hud"');
    expect(hud).toContain('accessibilityLabel="Open navigation performance tools"');
    expect(hud).toContain("setMenuOpen((open) => !open)");
    expect(hud).toContain('title="Navigation timeline"');
    expect(hud).toContain('title="Hermes CPU profile"');
    expect(hud).toContain('title="Hermes heap snapshot"');
    expect(hud).toContain("captureHermesHeapSnapshot()");
    expect(hud).toContain("serializeNavigationSpeedscopeProfile(profile)");
    expect(hud).toContain("<SpeedscopeProfileViewer");
    expect(hud).toContain('kind: "codewide-navigation-profile"');
    expect(screen).toContain("recordThreadNavigationRowCommit(connectionId, threadId, rowKey)");
    expect(screen).toContain("beginNavigationFrameTrace(navigationId)");
    expect(screen).toContain("endNavigationFrameTrace(completed.id)");
    expect(performanceModule).toContain("fun beginNavigationTrace(traceId: String, promise: Promise)");
    expect(performanceModule).toContain("fun endNavigationTrace(traceId: String, promise: Promise)");
    expect(performanceModule).toContain("activeNavigationTrace?.frames?.record");
    expect(performanceModule).toContain("HermesSamplingProfiler.enable()");
    expect(performanceModule).toContain("HermesSamplingProfiler.dumpSampledTraceToFile");
    expect(performanceModule).toContain('putString("content", hermesProfile.content)');
    expect(hud).toContain("hermesSamplingProfile: samplingProfile");
    expect(hud).not.toContain("<RichMarkdown");
  });
});
