import { describe, expect, it } from "vitest";

import {
  isPersistableHistoryAnchor,
  sanitizeHistoryAnchorOffset,
} from "../src/data/thread-history-anchor";

describe("sanitizeHistoryAnchorOffset", () => {
  it("preserves an exact offset deep inside a very tall row", () => {
    expect(sanitizeHistoryAnchorOffset(-25_432.75)).toBe(-25_432.75);
  });

  it("rejects non-finite offsets", () => {
    expect(sanitizeHistoryAnchorOffset(Number.NaN)).toBeNull();
    expect(sanitizeHistoryAnchorOffset(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("history anchor ownership", () => {
  it("never persists the mutable live tail", () => {
    expect(isPersistableHistoryAnchor({
      atEnd: true,
      anchorTurnId: "turn-live",
      anchorTurnStatus: "inProgress",
      activeTurnId: "turn-live",
    })).toBe(false);
    expect(isPersistableHistoryAnchor({
      atEnd: true,
      anchorTurnId: "turn-previous",
      anchorTurnStatus: "completed",
      activeTurnId: "turn-live",
    })).toBe(false);
  });

  it("persists only an immutable turn in a historical window", () => {
    expect(isPersistableHistoryAnchor({
      atEnd: false,
      anchorTurnId: "turn-history",
      anchorTurnStatus: "completed",
      activeTurnId: "turn-live",
    })).toBe(true);
    expect(isPersistableHistoryAnchor({
      atEnd: false,
      anchorTurnId: "turn-live",
      anchorTurnStatus: "inProgress",
      activeTurnId: "turn-live",
    })).toBe(false);
  });
});
