import { afterEach, describe, expect, it, vi } from "vitest";
import { searchDayFromCalendar, searchDayToCalendar } from "../src/features/search/search-calendar-date";
import { searchDateBoundary } from "../src/data/message-search";

afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("native search calendar days", () => {
  it.each(["America/Los_Angeles", "Pacific/Auckland", "Europe/Moscow"])("preserves the selected day in %s", zone => {
    vi.stubEnv("TZ", zone);
    const selected = searchDayFromCalendar(new Date("2026-09-07T00:00:00Z"));
    expect(selected).toBe("2026-09-07");
    expect(searchDayToCalendar(selected)).toBe("2026-09-07T00:00:00.000Z");
    expect(searchDateBoundary(selected, false)).toBe(new Date("2026-09-07T00:00:00").toISOString());
    expect(searchDateBoundary(selected, true)).toBe(new Date("2026-09-08T00:00:00").toISOString());
  });

  it("initializes an empty picker to the user's local day, not the UTC day", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T02:00:00Z"));
    expect(searchDayToCalendar("")).toBe("2026-09-06T00:00:00.000Z");
  });
});
