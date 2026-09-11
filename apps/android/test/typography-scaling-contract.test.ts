import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { APP_MAX_FONT_SIZE_MULTIPLIER } from "../src/ui/typography-policy";
import { compactSource, sourceObjectDeclaration } from "./source-contract";

const typography = readFileSync(new URL("../src/ui/Typography.tsx", import.meta.url), "utf8");
const heroNative = readFileSync(new URL("../src/ui/HeroUIRoot.native.tsx", import.meta.url), "utf8");
const screen = compactSource(readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8"));
const timelineList = readFileSync(new URL("../src/rendering/ThreadTimelineList.tsx", import.meta.url), "utf8");
const markdown = readFileSync(new URL("../src/rendering/RichMarkdown.tsx", import.meta.url), "utf8");
const errorBoundary = readFileSync(new URL("../src/ui/AppErrorBoundary.tsx", import.meta.url), "utf8");
const portForwarding = compactSource(readFileSync(new URL("../src/ui/PortForwardingManager.tsx", import.meta.url), "utf8"));
const codeReview = compactSource(readFileSync(new URL("../src/rendering/CodeReviewWorkspace.tsx", import.meta.url), "utf8"));

describe("windowed typography scaling contract", () => {
  it("keeps completed Activity on a text-sized row without extra top spacing", () => {
    const completedHistory = screen.slice(screen.indexOf("function CompletedTurnHistory("), screen.indexOf("function projectThreadItem("));
    expect(completedHistory).toMatch(/<TurnActivity\s+compactHeader\s/);
    expect(screen).toContain("compactHeader && styles.turnActivityCompact");
    expect(screen).toContain("compactHeader && styles.turnActivityToggleCompact");
    expect(screen).toContain("turnActivityCompact: { marginTop: 0 }");
    expect(screen).toContain("turnActivityToggleCompact: { minHeight: typeScale.body.lineHeight }");
    expect(screen).toContain("compactHeader = false");
  });

  it("keeps accessibility scaling bounded and identical across native text surfaces", () => {
    expect(APP_MAX_FONT_SIZE_MULTIPLIER).toBeGreaterThan(1);
    expect(APP_MAX_FONT_SIZE_MULTIPLIER).toBeLessThanOrEqual(1.3);
    expect(typography).toContain("maxFontSizeMultiplier = APP_MAX_FONT_SIZE_MULTIPLIER");
    expect(heroNative).toContain("maxFontSizeMultiplier: APP_MAX_FONT_SIZE_MULTIPLIER");
  });

  it("invalidates variable timeline measurements while keeping fixed thread rows stable", () => {
    expect(screen).toContain("windowLayout.measurementRevision");
    expect(screen).toContain('renderRevision={composerScope}');
    expect(screen).toContain('measurementRevision={windowLayout.measurementRevision}');
    expect(screen).not.toContain('key={`timeline-layout:${windowLayout.measurementRevision}`}');
    expect(timelineList).toContain('clearCaches({ mode: "sizes" })');
    expect(screen).toContain('dataKey={`desktop-threads:${activeServerId}:${mode}:${project?.key ?? "global"}`}');
    expect(screen).toContain('dataKey={`mobile-threads:${activeServerId}:${mode}:${project?.key ?? "global"}`}');
    expect(screen).not.toContain('extraData={windowLayout.measurementRevision}');
  });

  it("does not hard-code the diff header height around scalable text", () => {
    const diffFileHeader = sourceObjectDeclaration(screen, "diffFileHeader");
    expect(diffFileHeader).toContain('width: "100%"');
    expect(diffFileHeader).toContain("minHeight: controlSize.compact");
    expect(diffFileHeader).not.toMatch(/\bheight:/u);
  });

  it("lets text-bearing controls grow instead of clipping scaled labels", () => {
    expect(sourceObjectDeclaration(screen, "jumpToLatestBadge")).toContain("minHeight: 20");
    expect(sourceObjectDeclaration(screen, "voiceCapture")).toContain("minHeight: touchTarget");
    expect(sourceObjectDeclaration(screen, "transferProgress")).toContain("minHeight: controlSize.compact");
    expect(errorBoundary).toContain("minHeight: controlSize.regular");
    expect(sourceObjectDeclaration(portForwarding, "primaryButton")).toContain("minHeight: touchTarget");
    expect(sourceObjectDeclaration(codeReview, "modeButton")).toContain("minHeight: controlSize.compact");
    expect(sourceObjectDeclaration(codeReview, "commentChip")).toContain("minHeight: controlSize.compact");
  });

  it("does not shrink text blocks along the vertical flex axis", () => {
    expect(markdown).toContain("paragraph: { minWidth: 0, color:");
    expect(markdown).not.toContain('paragraph: { minWidth: 0, maxWidth: "100%"');
    expect(markdown).not.toContain("paragraph: { minWidth: 0, flexShrink: 1");
    expect(screen).not.toContain('agentText: { minWidth: 0, maxWidth: "100%", flexShrink: 1');
    expect(screen).not.toContain('protocolBody: { width: "100%", minWidth: 0, maxWidth: "100%", alignSelf: "stretch", flexShrink: 1');
  });
});
