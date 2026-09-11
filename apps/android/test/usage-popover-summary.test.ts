import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const usagePopover = readFileSync(new URL("../src/ui/UsagePopover.tsx", import.meta.url), "utf8");

describe("usage popover session summary", () => {
  it("centers the context percentage with native layout instead of Android SVG glyph metrics", () => {
    expect(usagePopover).not.toContain("SvgText");
    expect(usagePopover).toContain('style={styles.contextRingLabel}');
    expect(usagePopover).toContain('contextRingLabel: { position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }');
    expect(usagePopover).toContain('textAlign: "center", includeFontPadding: false');
  });

  it("keeps the price independent from optional and shrinkable metadata", () => {
    expect(usagePopover).not.toContain('accessibilityLabel="Compact thread context"');
    expect(usagePopover).not.toContain('"compact —"');
    expect(usagePopover).not.toContain('"cost —"');
    expect(usagePopover).toContain('testID="usage-session-tokens"');
    expect(usagePopover).toContain("prefix={TOKEN_SYMBOL}");
    expect(usagePopover).toContain('testID="usage-session-cost"');
    expect(usagePopover).toMatch(/sessionCostText: \{ flexShrink: 0,/);
    expect(usagePopover).toContain("cached: sessionUsage.cachedInputTokens");
    expect(usagePopover).toContain("cached: sessionCost.cachedInputCostUsd");
  });

});
