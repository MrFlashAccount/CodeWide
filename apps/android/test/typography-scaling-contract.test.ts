import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { APP_MAX_FONT_SIZE_MULTIPLIER } from "../src/ui/typography-policy";
import { compactSource, sourceObjectDeclaration } from "./source-contract";

const typography = readFileSync(new URL("../src/ui/Typography.tsx", import.meta.url), "utf8");
const productText = readFileSync(
  new URL("../src/presentation/text/ProductText.tsx", import.meta.url),
  "utf8",
);
const screen = compactSource(
  readFileSync(new URL("../app/(workspace)/_layout.tsx", import.meta.url), "utf8"),
);
const timelineList = readFileSync(
  new URL("../src/rendering/ThreadTimelineList.tsx", import.meta.url),
  "utf8",
);
const markdown = readFileSync(
  new URL("../src/rendering/RichMarkdown.tsx", import.meta.url),
  "utf8",
);
const errorBoundary = readFileSync(
  new URL("../src/ui/AppErrorBoundary.tsx", import.meta.url),
  "utf8",
);
const portForwarding = compactSource(
  readFileSync(
    new URL("../src/features/ports/PortForwardingManager.styles.ts", import.meta.url),
    "utf8",
  ),
);
const codeReviewStyles = compactSource(
  readFileSync(
    new URL("../src/features/review/workspace/CodeReviewWorkspace.styles.ts", import.meta.url),
    "utf8",
  ),
);
const codeReview = compactSource(
  readFileSync(
    new URL("../src/features/review/workspace/CodeReviewWorkspace.tsx", import.meta.url),
    "utf8",
  ),
);

const ownerThreadSidebar = compactSource(
  readFileSync(new URL("../src/features/threadList/ThreadSidebar.tsx", import.meta.url), "utf8"),
);
const ownerMobileThreads = compactSource(
  readFileSync(new URL("../src/features/threadList/MobileThreads.tsx", import.meta.url), "utf8"),
);

const ownerTurnActivity = compactSource(
  readFileSync(
    new URL("../src/features/conversation/turns/TurnActivity.tsx", import.meta.url),
    "utf8",
  ),
);
const ownerTurnActivityStyles = compactSource(
  readFileSync(
    new URL("../src/features/conversation/turns/TurnActivity.styles.ts", import.meta.url),
    "utf8",
  ),
);
const ownerTimelineViewport = compactSource(
  readFileSync(
    new URL("../src/features/conversation/timeline/TimelineViewport.tsx", import.meta.url),
    "utf8",
  ),
);

const completed = compactSource(
  readFileSync(
    new URL("../src/features/conversation/turns/CompletedTurnHistory.tsx", import.meta.url),
    "utf8",
  ),
);

const diffStyles = compactSource(
  readFileSync(
    new URL(
      "../src/features/conversation/protocol/FileChangeProtocolBlock.styles.ts",
      import.meta.url,
    ),
    "utf8",
  ),
);

const jumpStyles = compactSource(
  readFileSync(
    new URL("../src/features/conversation/timeline/JumpToLatest.styles.ts", import.meta.url),
    "utf8",
  ),
);

const voiceStyles = compactSource(
  readFileSync(
    new URL("../src/features/composer/voice/VoiceCaptureStatus.styles.ts", import.meta.url),
    "utf8",
  ),
);

describe("windowed typography scaling contract", () => {
  it("keeps completed Activity on a text-sized row without extra top spacing", () => {
    const completedHistory = completed;
    expect(completedHistory).toMatch(/<TurnActivity\s+compactHeader\s/);
    expect(ownerTurnActivity).toContain("compactHeader && styles.turnActivityCompact");
    expect(ownerTurnActivity).toContain("compactHeader && styles.turnActivityToggleCompact");
    expect(ownerTurnActivityStyles).toContain("turnActivityCompact: { marginTop: 0 }");
    expect(ownerTurnActivityStyles).toContain(
      "turnActivityToggleCompact: { minHeight: typeScale.body.lineHeight }",
    );
    expect(ownerTurnActivity).toContain("const compactHeader = props.compactHeader ?? false");
  });

  it("keeps accessibility scaling bounded and identical across native text surfaces", () => {
    expect(APP_MAX_FONT_SIZE_MULTIPLIER).toBeGreaterThan(1);
    expect(APP_MAX_FONT_SIZE_MULTIPLIER).toBeLessThanOrEqual(1.3);
    expect(typography).toContain("maxFontSizeMultiplier = APP_MAX_FONT_SIZE_MULTIPLIER");
    expect(productText).toContain("maxFontSizeMultiplier = APP_MAX_FONT_SIZE_MULTIPLIER");
  });

  it("invalidates variable timeline measurements while keeping fixed thread rows stable", () => {
    expect(ownerTimelineViewport).toContain("windowLayout.measurementRevision");
    expect(ownerTimelineViewport).toContain("renderRevision={props.composerScope}");
    expect(ownerTimelineViewport).not.toContain("measurementRevision={");
    expect(screen).not.toContain("key={`timeline-layout:${windowLayout.measurementRevision}`}");
    expect(timelineList).toContain("subscribeMeasurementInvalidation(invalidateMeasurements)");
    expect(timelineList).toContain('clearCaches({ mode: "sizes" })');
    expect(timelineList).not.toContain("useLayoutEffect");
    expect(ownerThreadSidebar).toContain(
      'dataKey={`desktop-threads:${serverScope.kind === "all" ? "all" : serverScope.connectionId}:${mode}:${project?.key ?? "global"}`}',
    );
    expect(ownerMobileThreads).toContain(
      'dataKey={`mobile-threads:${serverScope.kind === "all" ? "all" : serverScope.connectionId}:${mode}:${project?.key ?? "global"}`}',
    );
    expect(screen).not.toContain("extraData={windowLayout.measurementRevision}");
  });

  it("does not hard-code the diff header height around scalable text", () => {
    const diffFileHeader = sourceObjectDeclaration(diffStyles, "diffFileHeader");
    expect(diffFileHeader).toContain('width: "100%"');
    expect(diffFileHeader).toContain("minHeight: controlSize.compact");
    expect(diffFileHeader).not.toMatch(/\bheight:/u);
  });

  it("lets text-bearing controls grow instead of clipping scaled labels", () => {
    expect(sourceObjectDeclaration(jumpStyles, "jumpToLatestBadge")).toContain("minHeight: 20");
    expect(sourceObjectDeclaration(voiceStyles, "voiceCapture")).toContain(
      "minHeight: touchTarget",
    );
    // The approved ledger deletes this unused style; live text-bearing controls remain checked below.
    expect(sourceObjectDeclaration(screen, "transferProgress")).toBe("");
    expect(errorBoundary).toContain("minHeight: controlSize.regular");
    expect(sourceObjectDeclaration(portForwarding, "primaryButton")).toContain(
      "minHeight: touchTarget",
    );
    expect(sourceObjectDeclaration(codeReviewStyles, "modeButton")).toContain(
      "minHeight: controlSize.compact",
    );
    expect(sourceObjectDeclaration(codeReviewStyles, "commentChip")).toContain(
      "minHeight: controlSize.compact",
    );
  });

  it("does not shrink text blocks along the vertical flex axis", () => {
    const paragraphStyle = sourceObjectDeclaration(markdown, "paragraph");
    expect(paragraphStyle).toContain("minWidth: 0");
    expect(paragraphStyle).toContain("color: colors.text");
    expect(markdown).not.toContain('paragraph: { minWidth: 0, maxWidth: "100%"');
    expect(markdown).not.toContain("paragraph: { minWidth: 0, flexShrink: 1");
    expect(screen).not.toContain('agentText: { minWidth: 0, maxWidth: "100%", flexShrink: 1');
    expect(screen).not.toContain(
      'protocolBody: { width: "100%", minWidth: 0, maxWidth: "100%", alignSelf: "stretch", flexShrink: 1',
    );
  });
});
