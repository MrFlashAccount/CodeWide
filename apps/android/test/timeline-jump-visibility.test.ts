import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimelineJumpVisibility } from "../src/features/conversation/timeline/timelineJumpVisibility";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("jump-to-latest visibility", () => {
  it.each([0, 8, 11.9, 12])("stays hidden within the 12 dp edge zone (%s)", (distance) => {
    const visibility = new TimelineJumpVisibility();
    visibility.update(distance, true);
    vi.advanceTimersByTime(1_000);
    expect(visibility.visible$.get()).toBe(false);
  });

  it("appears after 200 ms beyond the edge without postponing on every scroll sample", () => {
    const visibility = new TimelineJumpVisibility();
    visibility.update(12.1, true);
    vi.advanceTimersByTime(100);
    visibility.update(30, true);
    vi.advanceTimersByTime(99);
    expect(visibility.visible$.get()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(visibility.visible$.get()).toBe(true);
  });

  it("cancels brief excursions and requires a fresh uninterrupted 200 ms", () => {
    const visibility = new TimelineJumpVisibility();
    visibility.update(100, true);
    vi.advanceTimersByTime(150);
    visibility.update(12, true);
    visibility.update(100, true);
    vi.advanceTimersByTime(199);
    expect(visibility.visible$.get()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(visibility.visible$.get()).toBe(true);
  });

  it("hides immediately on returning to the edge, without a hide debounce", () => {
    const visibility = new TimelineJumpVisibility();
    visibility.update(100, true);
    vi.advanceTimersByTime(200);
    expect(visibility.visible$.get()).toBe(true);
    visibility.update(12, true);
    expect(visibility.visible$.get()).toBe(false);
    vi.advanceTimersByTime(1_000);
    expect(visibility.visible$.get()).toBe(false);
  });

  it("still offers the absolute tail at the bottom of an older history window", () => {
    const visibility = new TimelineJumpVisibility();
    visibility.update(0, false);
    vi.advanceTimersByTime(200);
    expect(visibility.visible$.get()).toBe(true);
    visibility.update(0, true);
    expect(visibility.visible$.get()).toBe(false);
  });

  it("cancels a pending appearance when its activation is released", () => {
    const visibility = new TimelineJumpVisibility();
    visibility.update(100, true);
    vi.advanceTimersByTime(100);
    visibility.reset();
    vi.advanceTimersByTime(1_000);
    expect(visibility.visible$.get()).toBe(false);
  });
});
