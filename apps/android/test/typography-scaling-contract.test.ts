import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { APP_MAX_FONT_SIZE_MULTIPLIER } from "../src/ui/typography-policy";

const typography = readFileSync(new URL("../src/ui/Typography.tsx", import.meta.url), "utf8");
const heroNative = readFileSync(new URL("../src/ui/HeroUIRoot.native.tsx", import.meta.url), "utf8");
const screen = readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8");
const timelineList = readFileSync(new URL("../src/rendering/ThreadTimelineList.tsx", import.meta.url), "utf8");
const markdown = readFileSync(new URL("../src/rendering/RichMarkdown.tsx", import.meta.url), "utf8");
const errorBoundary = readFileSync(new URL("../src/ui/AppErrorBoundary.tsx", import.meta.url), "utf8");
const portForwarding = readFileSync(new URL("../src/ui/PortForwardingManager.tsx", import.meta.url), "utf8");
const codeReview = readFileSync(new URL("../src/rendering/CodeReviewWorkspace.tsx", import.meta.url), "utf8");

describe("windowed typography scaling contract", () => {
  it("keeps accessibility scaling bounded and identical across native text surfaces", () => {
    expect(APP_MAX_FONT_SIZE_MULTIPLIER).toBeGreaterThan(1);
    expect(APP_MAX_FONT_SIZE_MULTIPLIER).toBeLessThanOrEqual(1.3);
    expect(typography).toContain("maxFontSizeMultiplier = APP_MAX_FONT_SIZE_MULTIPLIER");
    expect(heroNative).toContain("maxFontSizeMultiplier: APP_MAX_FONT_SIZE_MULTIPLIER");
  });

  it("invalidates virtualized measurements when density or font scale changes", () => {
    expect(screen).toContain("windowLayout.measurementRevision");
    expect(screen).toContain('renderRevision={composerScope}');
    expect(screen).toContain('measurementRevision={windowLayout.measurementRevision}');
    expect(screen).not.toContain('key={`timeline-layout:${windowLayout.measurementRevision}`}');
    expect(timelineList).toContain('clearCaches({ mode: "sizes" })');
    expect(screen).toContain('dataKey={`desktop-threads:${windowLayout.measurementRevision}`}');
    expect(screen).toContain('dataKey={`mobile-threads:${windowLayout.measurementRevision}`}');
  });

  it("does not hard-code the diff header height around scalable text", () => {
    expect(screen).toContain('diffFileHeader: { width: "100%", minWidth: 0, minHeight: 30');
    expect(screen).not.toContain('diffFileHeader: { width: "100%", minWidth: 0, height: 30');
  });

  it("lets text-bearing controls grow instead of clipping scaled labels", () => {
    expect(screen).toContain('jumpToLatestBadge: { position: "absolute", top: -3, right: -3, minWidth: 20, minHeight: 20');
    expect(screen).toContain('voiceCapture: { flex: 1, minHeight: touchTarget');
    expect(screen).toContain('transferProgress: { minHeight: 34');
    expect(errorBoundary).toContain("minHeight: 36");
    expect(portForwarding).toContain('primaryButton: { minWidth: 96, minHeight: touchTarget');
    expect(codeReview).toContain('modeButton: { minWidth: 68, minHeight: 31');
    expect(codeReview).toContain('commentChip: { maxWidth: 300, minHeight: 38');
  });

  it("does not shrink text blocks along the vertical flex axis", () => {
    expect(markdown).toContain("paragraph: { minWidth: 0, color:");
    expect(markdown).not.toContain('paragraph: { minWidth: 0, maxWidth: "100%"');
    expect(markdown).not.toContain("paragraph: { minWidth: 0, flexShrink: 1");
    expect(screen).not.toContain('agentText: { minWidth: 0, maxWidth: "100%", flexShrink: 1');
    expect(screen).not.toContain('protocolBody: { width: "100%", minWidth: 0, maxWidth: "100%", alignSelf: "stretch", flexShrink: 1');
  });
});
