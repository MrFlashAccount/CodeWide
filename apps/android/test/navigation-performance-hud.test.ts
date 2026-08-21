import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const hud = readFileSync(new URL("../src/ui/NavigationPerformanceHud.tsx", import.meta.url), "utf8");
const nativeRoot = readFileSync(new URL("../src/ui/HeroUIRoot.native.tsx", import.meta.url), "utf8");
const screen = readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8");
const performanceModule = readFileSync(new URL("../android/app/src/main/java/dev/codewide/app/performance/CodexPerformanceModule.kt", import.meta.url), "utf8");

describe("navigation performance HUD", () => {
  it("profiles virtualized chat navigation without rendering message content", () => {
    expect(nativeRoot).toContain("<NavigationPerformanceHud />");
    expect(hud).toContain("if (!metrics.enabled) return null");
    expect(hud).toContain('testID="navigation-performance-hud"');
    expect(hud).toContain('pointerEvents="none"');
    expect(screen).toContain("recordThreadNavigationRowCommit(connectionId, threadId, rowKey)");
    expect(screen).toContain("beginNavigationFrameTrace(navigationId)");
    expect(screen).toContain("endNavigationFrameTrace(completed.id)");
    expect(performanceModule).toContain("fun beginNavigationTrace(traceId: String, promise: Promise)");
    expect(performanceModule).toContain("fun endNavigationTrace(traceId: String, promise: Promise)");
    expect(performanceModule).toContain("activeNavigationTrace?.frames?.record");
    expect(hud).not.toMatch(/threadId|connectionId|message|content/u);
  });
});
