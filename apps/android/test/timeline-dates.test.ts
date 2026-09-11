import { describe, expect, it } from "vitest";
import { TimelineDateSequence } from "../src/presentation/conversation/timelineDates";

const time = (day: number, hour: number, minute: number, second = 0) => new Date(2026, 8, day, hour, minute, second).getTime();
const label = (timestamp: number) => new Date(timestamp).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

describe("adjacent message calendar boundaries", () => {
  it("places midnight before the response, not the following request", () => {
    const dates = new TimelineDateSequence(false);
    expect(dates.next(time(8, 23, 37))).toBeNull();
    expect(dates.next(time(9, 0, 14))).toBe(label(time(9, 0, 14)));
    expect(dates.next(time(9, 0, 16))).toBeNull();
  });

  it("detects a one-second midnight crossing, not a 24-hour duration", () => {
    const dates = new TimelineDateSequence(false);
    dates.next(time(8, 23, 59, 59));
    expect(dates.next(time(9, 0, 0))).toBe(label(time(9, 0, 0)));
  });

  it("does not manufacture a boundary at a partial page's first message", () => {
    const dates = new TimelineDateSequence(false);
    expect(dates.next(time(8, 22, 33))).toBeNull();
    expect(dates.next(time(8, 22, 45))).toBeNull();
    const complete = new TimelineDateSequence(true);
    expect(complete.next(time(8, 22, 33))).toBe(label(time(8, 22, 33)));
  });

  it("recomputes the same real boundary after an older page is prepended", () => {
    const partial = new TimelineDateSequence(false);
    partial.next(time(8, 23, 37));
    const boundary = partial.next(time(9, 0, 14));
    const expanded = new TimelineDateSequence(false);
    expanded.next(time(8, 22, 30));
    expect(expanded.next(time(8, 23, 37))).toBeNull();
    expect(expanded.next(time(9, 0, 14))).toBe(boundary);
    expect(boundary).toBe(label(time(9, 0, 14)));
  });

  it("does not infer dates across unknown or invalid timestamps", () => {
    const dates = new TimelineDateSequence(true);
    expect(dates.next(null)).toBeNull();
    expect(dates.next(time(8, 22, 30))).toBeNull();
    expect(dates.next(Number.NaN)).toBeNull();
    expect(dates.next(time(9, 0, 14))).toBeNull();
  });
});
