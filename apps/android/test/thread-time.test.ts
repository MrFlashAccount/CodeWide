import { describe, expect, it } from "vitest";

import { formatThreadRecency } from "../src/features/threadList/threadTime";

const preferences = { locale: "en-US", uses24HourClock: true } as const;

function timestamp(year: number, month: number, day: number, hour = 12, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute).getTime() / 1000;
}

describe("thread recency label", () => {
  const now = timestamp(2026, 10, 10, 20, 52);

  it("shows only the device-formatted time for today", () => {
    expect(formatThreadRecency(timestamp(2026, 10, 10, 13, 5), preferences, now)).toBe("13:05");
  });

  it("shows a short weekday for the previous six calendar days", () => {
    expect(formatThreadRecency(timestamp(2026, 10, 9), preferences, now)).toBe("Fri");
    expect(formatThreadRecency(timestamp(2026, 10, 4), preferences, now)).toBe("Sun");
  });

  it("shows short month and day after the recent-week window in the current year", () => {
    expect(formatThreadRecency(timestamp(2026, 10, 3), preferences, now)).toBe("Oct 3");
    expect(formatThreadRecency(timestamp(2026, 7, 17), preferences, now)).toBe("Jul 17");
  });

  it("shows an explicit numeric date for an earlier year", () => {
    expect(formatThreadRecency(timestamp(2025, 7, 17), preferences, now)).toBe("17.07.25");
  });

  it("keeps a nearby previous-year date in the recent-week window", () => {
    const januaryNow = timestamp(2026, 1, 2, 12);
    expect(formatThreadRecency(timestamp(2025, 12, 31), preferences, januaryNow)).toBe("Wed");
  });
});
