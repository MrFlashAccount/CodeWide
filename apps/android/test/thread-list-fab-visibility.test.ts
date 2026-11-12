import { describe, expect, it } from "vitest";

import {
  INITIAL_THREAD_LIST_FAB_VISIBILITY,
  nextThreadListFabVisibility,
  THREAD_LIST_FAB_DIRECTION_THRESHOLD,
  THREAD_LIST_FAB_TOP_REGION,
  type ThreadListFabVisibility,
} from "../src/features/threadList/threadListFabVisibility";

const MAX_OFFSET = 2_000;
const START = 600;

function scrollThrough(
  state: ThreadListFabVisibility,
  offsets: readonly number[],
  { maxOffset = MAX_OFFSET, tracking = true } = {},
): ThreadListFabVisibility {
  let current = state;
  for (const offset of offsets) {
    current = nextThreadListFabVisibility(current, { maxOffset, offset, tracking });
  }
  return current;
}

/** A shown state anchored mid-list, as after a gesture begins there. */
const shownMidList = scrollThrough(INITIAL_THREAD_LIST_FAB_VISIBILITY, [START], {
  tracking: false,
});

describe("thread list floating action visibility", () => {
  it("keeps the actions shown while downward jitter stays below the threshold", () => {
    const below = START + THREAD_LIST_FAB_DIRECTION_THRESHOLD - 1;
    const state = scrollThrough(shownMidList, [START + 4, START + 2, below, START + 10]);
    expect(state.shown).toBe(true);
  });

  it("hides once one-direction travel reaches the threshold, even across small steps", () => {
    const steps = Array.from(
      { length: THREAD_LIST_FAB_DIRECTION_THRESHOLD },
      (_, index) => START + index + 1,
    );
    const state = scrollThrough(shownMidList, steps);
    expect(state.shown).toBe(false);
  });

  it("measures the threshold from the lowest offset, so up-then-down jitter does not hide", () => {
    const state = scrollThrough(shownMidList, [START - 10, START + 10, START - 5, START + 12]);
    expect(state.shown).toBe(true);
  });

  it("shows again only after upward travel from the deepest offset reaches the threshold", () => {
    const hidden = scrollThrough(shownMidList, [START + 100, START + 300]);
    expect(hidden.shown).toBe(false);
    const jitter = scrollThrough(hidden, [START + 290, START + 299, START + 280]);
    expect(jitter.shown).toBe(false);
    const shown = scrollThrough(jitter, [START + 300 - THREAD_LIST_FAB_DIRECTION_THRESHOLD]);
    expect(shown.shown).toBe(true);
  });

  it("forces the actions shown near the top regardless of direction", () => {
    const hidden = scrollThrough(shownMidList, [START + 200]);
    expect(hidden.shown).toBe(false);
    expect(scrollThrough(hidden, [THREAD_LIST_FAB_TOP_REGION]).shown).toBe(true);
    expect(scrollThrough(hidden, [0], { tracking: false }).shown).toBe(true);
    expect(scrollThrough(hidden, [-12]).shown).toBe(true);
  });

  it("keeps the actions shown when the content does not scroll", () => {
    const hidden = scrollThrough(shownMidList, [START + 200]);
    expect(scrollThrough(hidden, [START + 400], { maxOffset: 0 }).shown).toBe(true);
  });

  it("ignores overscroll past the end and its bounce back", () => {
    const hidden = scrollThrough(shownMidList, [MAX_OFFSET - 50, MAX_OFFSET]);
    expect(hidden.shown).toBe(false);
    const bounced = scrollThrough(hidden, [MAX_OFFSET + 60, MAX_OFFSET + 30, MAX_OFFSET]);
    expect(bounced).toEqual(hidden);
    expect(bounced.shown).toBe(false);
  });

  it("re-anchors on offsets the user did not scroll instead of toggling", () => {
    const shifted = scrollThrough(shownMidList, [START + 400], { tracking: false });
    expect(shifted.shown).toBe(true);
    expect(scrollThrough(shifted, [START + 410]).shown).toBe(true);
  });

  it("returns the same state for a sample that changes nothing", () => {
    expect(scrollThrough(shownMidList, [START + 1])).toBe(shownMidList);
  });
});
