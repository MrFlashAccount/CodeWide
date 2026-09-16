import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { sourceObjectDeclaration } from "./source-contract";

const usageMenu = readFileSync(
  new URL("../src/features/accounts/UsageMenu.tsx", import.meta.url),
  "utf8",
);

const usageStyles = readFileSync(
  new URL("../src/features/accounts/UsageMenu.styles.ts", import.meta.url),
  "utf8",
);
const sessionSummary = readFileSync(
  new URL("../src/features/accounts/SessionUsageSummary.tsx", import.meta.url),
  "utf8",
);

const ownerContextRingView = readFileSync(
  new URL("../src/features/accounts/ContextRingView.tsx", import.meta.url),
  "utf8",
);

describe("usage menu session summary", () => {
  it("centers the context percentage with native layout instead of Android SVG glyph metrics", () => {
    expect(usageMenu).not.toContain("SvgText");
    expect(ownerContextRingView).toContain("style={styles.contextRingLabel}");
    const labelStyle = sourceObjectDeclaration(usageStyles, "contextRingLabel");
    expect(labelStyle).toContain('position: "absolute"');
    expect(labelStyle).toContain("inset: 0");
    expect(labelStyle).toContain('alignItems: "center"');
    expect(labelStyle).toContain('justifyContent: "center"');
    const textStyle = sourceObjectDeclaration(usageStyles, "contextRingLabelText");
    expect(textStyle).toContain('textAlign: "center"');
    expect(textStyle).toContain("includeFontPadding: false");
  });

  it("keeps the price independent from optional and shrinkable metadata", () => {
    expect(usageMenu).not.toContain('accessibilityLabel="Compact thread context"');
    expect(usageMenu).not.toContain('"compact —"');
    expect(usageMenu).not.toContain('"cost —"');
    expect(sessionSummary).toContain('testID="usage-session-tokens"');
    expect(usageMenu).toContain("prefix={TOKEN_SYMBOL}");
    expect(sessionSummary).toContain('testID="usage-session-cost"');
    expect(sourceObjectDeclaration(usageStyles, "sessionCostText")).toContain("flexShrink: 0");
    expect(sessionSummary).toContain("cached: sessionUsage.cachedInputTokens");
    expect(sessionSummary).toContain("cached: sessionCost.cachedInputCostUsd");
  });
});
