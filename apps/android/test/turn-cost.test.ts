import { describe, expect, it } from "vitest";

import { formatEstimatedTurnCost } from "../src/turn-cost";

describe("turn cost presentation", () => {
  it("formats the companion-owned estimate without repricing it", () => {
    expect(formatEstimatedTurnCost(0.004123)).toBe("$0.0041");
    expect(formatEstimatedTurnCost(0.1234)).toBe("$0.123");
    expect(formatEstimatedTurnCost(1.234)).toBe("$1.23");
    expect(formatEstimatedTurnCost(Number.NaN)).toBe("—");
  });
});
