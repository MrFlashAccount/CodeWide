import { describe, expect, it } from "vitest";

import {
  COMPOSER_SWIPE_THRESHOLD,
  COMPOSER_SWIPE_TARGET,
  composerSwipeArmed,
  composerSwipeDirection,
  composerSwipeTravel,
} from "../src/ui/composer-swipe";

describe("composer swipe discard", () => {
  it("recognizes left discard and upward steer, not right or downward swipes", () => {
    expect(composerSwipeDirection(-30, -10)).toBe("discard");
    expect(composerSwipeDirection(-10, -30)).toBe("steer");
    expect(composerSwipeDirection(30, -10)).toBe("none");
    expect(composerSwipeDirection(-10, 30)).toBe("none");
    expect(composerSwipeDirection(0, 0)).toBe("none");
  });

  it("requires deliberate travel and lets the user retract before releasing", () => {
    expect(composerSwipeArmed(0)).toBe(false);
    expect(composerSwipeArmed(COMPOSER_SWIPE_THRESHOLD - 1)).toBe(false);
    expect(composerSwipeArmed(COMPOSER_SWIPE_THRESHOLD)).toBe(true);
    expect(composerSwipeArmed(COMPOSER_SWIPE_THRESHOLD + 20)).toBe(true);
    expect(composerSwipeArmed(COMPOSER_SWIPE_THRESHOLD - 10)).toBe(false);
    expect(composerSwipeArmed(-100)).toBe(false);
  });

  it("keeps visual travel short, continuous and increasingly resistant beyond the threshold", () => {
    const threshold = COMPOSER_SWIPE_THRESHOLD;
    expect(composerSwipeTravel(-100)).toBe(0);
    expect(composerSwipeTravel(0)).toBe(0);
    expect(composerSwipeTravel(threshold)).toBe(COMPOSER_SWIPE_TARGET);
    expect(composerSwipeTravel(threshold + 0.001) - composerSwipeTravel(threshold)).toBeLessThan(
      0.001,
    );
    const first = composerSwipeTravel(threshold + 20) - composerSwipeTravel(threshold);
    const second = composerSwipeTravel(threshold + 40) - composerSwipeTravel(threshold + 20);
    expect(first).toBeGreaterThan(second);
    expect(second).toBeGreaterThan(0);
    expect(composerSwipeTravel(10_000)).toBeLessThan(threshold);
  });
});
