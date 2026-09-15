import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const usagePopover = readFileSync(new URL("../src/features/accounts/UsagePopover.tsx", import.meta.url), "utf8");

const usageStyles = readFileSync(new URL("../src/features/accounts/UsagePopover.styles.ts", import.meta.url), "utf8");
const sessionSummary = readFileSync(new URL("../src/features/accounts/SessionUsageSummary.tsx", import.meta.url), "utf8");

const ownerContextRingView = readFileSync(new URL("../src/features/accounts/ContextRingView.tsx", import.meta.url), "utf8");

describe("usage popover session summary", () => {
  it("centers the context percentage with native layout instead of Android SVG glyph metrics", () => {
    expect(usagePopover).not.toContain("SvgText");
    expect(ownerContextRingView).toContain("style={styles.contextRingLabel}");
    expect(usageStyles).toContain("contextRingLabel: {\n    position: \"absolute\",\n    inset: 0,\n    alignItems: \"center\",\n    justifyContent: \"center\",\n  }");
    expect(usageStyles).toContain("textAlign: \"center\",\n    includeFontPadding: false");
  });

  it("keeps the price independent from optional and shrinkable metadata", () => {
    expect(usagePopover).not.toContain('accessibilityLabel="Compact thread context"');
    expect(usagePopover).not.toContain('"compact —"');
    expect(usagePopover).not.toContain('"cost —"');
    expect(sessionSummary).toContain('testID="usage-session-tokens"');
    expect(usagePopover).toContain("prefix={TOKEN_SYMBOL}");
    expect(sessionSummary).toContain('testID="usage-session-cost"');
    expect(usageStyles).toMatch(/sessionCostText: \{\s*flexShrink: 0,/);
    expect(sessionSummary).toContain("cached: sessionUsage.cachedInputTokens");
    expect(sessionSummary).toContain("cached: sessionCost.cachedInputCostUsd");
  });

});
