import { describe, expect, it } from "vitest";

import { sanitizeHistoryAnchorOffset } from "../src/data/thread-history-anchor";

describe("sanitizeHistoryAnchorOffset", () => {
  it("preserves an exact offset deep inside a very tall row", () => {
    expect(sanitizeHistoryAnchorOffset(-25_432.75)).toBe(-25_432.75);
  });

  it("rejects non-finite offsets", () => {
    expect(sanitizeHistoryAnchorOffset(Number.NaN)).toBeNull();
    expect(sanitizeHistoryAnchorOffset(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
