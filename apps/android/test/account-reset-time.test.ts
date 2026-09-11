import { describe, expect, it } from "vitest";

import { formatDateTimeForDevice } from "../src/data/device-time-format";
import { relativeResetTime } from "../src/data/account-rate-limits";

describe("account reset time", () => {
  const timestamp = new Date(2026, 8, 14, 22, 52).getTime() / 1_000;

  it("uses the selected locale for the calendar date and the explicit device clock mode", () => {
    const russian = formatDateTimeForDevice(timestamp, { locale: "ru-RU", uses24HourClock: true });
    expect(russian).toContain("сент.");
    expect(russian).toContain("22:52");
    const english24 = formatDateTimeForDevice(timestamp, { locale: "en-US", uses24HourClock: true });
    expect(english24).toContain("Sep");
    expect(english24).toContain("22:52");
    const english12 = formatDateTimeForDevice(timestamp, { locale: "en-US", uses24HourClock: false });
    expect(english12).toContain("10:52");
    expect(english12).toContain("PM");
  });

  it("keeps the countdown compact without zero-valued trailing units", () => {
    expect(relativeResetTime(timestamp + 7 * 86400, timestamp * 1000)).toBe("in 7d");
    expect(relativeResetTime(timestamp + 2 * 86400 + 4 * 3600, timestamp * 1000)).toBe("in 2d 4h");
    expect(relativeResetTime(timestamp + 4 * 3600, timestamp * 1000)).toBe("in 4h");
    expect(relativeResetTime(timestamp + 60, timestamp * 1000)).toBe("in 1m");
    expect(relativeResetTime(timestamp, timestamp * 1000)).toBe("reset due");
    expect(relativeResetTime(null, timestamp * 1000)).toBeNull();
  });
});
