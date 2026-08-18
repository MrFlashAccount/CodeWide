import { describe, expect, it } from "vitest";

import {
  advanceResidentOffset,
  retreatResidentOffset,
  shouldPrefetchOlderPage,
  THREAD_HISTORY_PAGE_SIZE,
  THREAD_RESIDENT_TURN_LIMIT,
  THREAD_TURN_PAGE_SIZE,
} from "../src/data/thread-pagination";

describe("thread page prefetch", () => {
  it("starts inside the oldest half-page instead of waiting for index zero", () => {
    expect(THREAD_TURN_PAGE_SIZE).toBe(6);
    expect(THREAD_HISTORY_PAGE_SIZE).toBe(12);
    expect(shouldPrefetchOlderPage(6, true)).toBe(false);
    expect(shouldPrefetchOlderPage(5, true)).toBe(true);
    expect(shouldPrefetchOlderPage(0, true)).toBe(true);
  });

  it("does not prefetch while moving toward newer turns or before visibility is known", () => {
    expect(shouldPrefetchOlderPage(2, false)).toBe(false);
    expect(shouldPrefetchOlderPage(null, true)).toBe(false);
  });
});

describe("bounded resident history window", () => {
  it("keeps the hot set bounded while older pages remain addressable", () => {
    expect(advanceResidentOffset(0, THREAD_RESIDENT_TURN_LIMIT - 3, 12)).toBe(9);
    expect(advanceResidentOffset(9, THREAD_RESIDENT_TURN_LIMIT, 12)).toBe(21);
  });

  it("moves back toward live history by one page without underflow", () => {
    expect(retreatResidentOffset(21)).toBe(9);
    expect(retreatResidentOffset(9)).toBe(0);
    expect(retreatResidentOffset(0)).toBe(0);
  });
});
