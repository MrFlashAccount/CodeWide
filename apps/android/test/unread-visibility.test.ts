import { describe, expect, it } from "vitest";

import {
  claimUnreadReceipt,
  requiredAgentResponseVisibleHeight,
  shouldMarkAgentResponseRead,
  visibleHeightWithinViewport,
} from "../src/rendering/unread-visibility";

describe("unread agent response visibility", () => {
  it("requires a short response to be fully visible", () => {
    expect(requiredAgentResponseVisibleHeight(40, 100)).toBe(40);
    expect(visibleHeightWithinViewport(160, 40, 100, 100)).toBe(40);
    expect(shouldMarkAgentResponseRead(160, 40, 100, 100)).toBe(true);
    expect(shouldMarkAgentResponseRead(161, 40, 100, 100)).toBe(false);
  });

  it("requires half of a response that is taller than half the viewport", () => {
    expect(requiredAgentResponseVisibleHeight(80, 100)).toBe(40);
    expect(shouldMarkAgentResponseRead(160, 80, 100, 100)).toBe(true);
    expect(shouldMarkAgentResponseRead(161, 80, 100, 100)).toBe(false);
  });

  it("caps a very long response at half the viewport", () => {
    expect(requiredAgentResponseVisibleHeight(400, 100)).toBe(50);
    expect(shouldMarkAgentResponseRead(150, 400, 100, 100)).toBe(true);
    expect(shouldMarkAgentResponseRead(151, 400, 100, 100)).toBe(false);
  });

  it("does not mark offscreen or zero-sized content read", () => {
    expect(shouldMarkAgentResponseRead(201, 100, 100, 100)).toBe(false);
    expect(shouldMarkAgentResponseRead(100, 0, 100, 100)).toBe(false);
  });

  it("lets only the first concurrent path claim the current receipt", () => {
    let acknowledged: string | null = null;
    acknowledged = claimUnreadReceipt("receipt-1", acknowledged, "receipt-1");
    expect(acknowledged).toBe("receipt-1");
    expect(claimUnreadReceipt("receipt-1", acknowledged, "receipt-1")).toBeNull();
    expect(claimUnreadReceipt("receipt-2", acknowledged, "receipt-1")).toBeNull();
  });
});
