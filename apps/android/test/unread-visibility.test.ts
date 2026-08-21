import { describe, expect, it } from "vitest";

import { shouldMarkAgentResponseRead, visibleRatioWithinViewport } from "../src/rendering/unread-visibility";

describe("unread agent response visibility", () => {
  it("marks a normal response read once 30 percent is visible", () => {
    expect(visibleRatioWithinViewport(170, 100, 100, 100)).toBe(0.3);
    expect(shouldMarkAgentResponseRead(170, 100, 100, 100)).toBe(true);
    expect(shouldMarkAgentResponseRead(171, 100, 100, 100)).toBe(false);
  });

  it("uses the viewport as the denominator for an answer taller than the viewport", () => {
    expect(visibleRatioWithinViewport(170, 400, 100, 100)).toBe(0.3);
    expect(shouldMarkAgentResponseRead(170, 400, 100, 100)).toBe(true);
  });

  it("does not mark offscreen or zero-sized content read", () => {
    expect(shouldMarkAgentResponseRead(201, 100, 100, 100)).toBe(false);
    expect(shouldMarkAgentResponseRead(100, 0, 100, 100)).toBe(false);
  });
});
