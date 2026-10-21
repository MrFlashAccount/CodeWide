import { describe, expect, it } from "vitest";

import { APP_MAX_FONT_SIZE_MULTIPLIER } from "../src/ui/typography-policy";

describe("windowed typography scaling contract", () => {
  it("keeps accessibility scaling bounded and identical across native text surfaces", () => {
    expect(APP_MAX_FONT_SIZE_MULTIPLIER).toBeGreaterThan(1);
    expect(APP_MAX_FONT_SIZE_MULTIPLIER).toBeLessThanOrEqual(1.3);
  });
});
