import { describe, expect, it } from "vitest";
import { typeScale } from "../src/theme";
import { inlineIconMetrics } from "../src/ui/inline-icon-metrics";
import { APP_MAX_FONT_SIZE_MULTIPLIER } from "../src/ui/typography-policy";

describe("text-adjacent icon geometry", () => {
  it.each([0.85, 1, 1.15, 1.3, 2])("keeps glyphs inside their text line at font scale %s", (scale) => {
    for (const role of ["caption", "label", "body", "title"] as const) {
      const metrics = inlineIconMetrics(role, scale);
      const multiplier = Math.min(scale, APP_MAX_FONT_SIZE_MULTIPLIER);
      expect(metrics.slot).toBe(typeScale[role].lineHeight * multiplier);
      expect(metrics.glyph).toBeLessThanOrEqual(metrics.slot);
      expect(metrics.glyph / multiplier).toBeCloseTo(inlineIconMetrics(role, 1).glyph);
    }
    expect(inlineIconMetrics("caption", scale).glyph).toBeLessThan(inlineIconMetrics("label", scale).glyph);
    expect(inlineIconMetrics("label", scale).glyph).toBeLessThan(inlineIconMetrics("body", scale).glyph);
  });
});
