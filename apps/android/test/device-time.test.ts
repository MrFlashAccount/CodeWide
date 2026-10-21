import { describe, expect, it } from "vitest";

import { formatTimeForDevice } from "../src/data/device-time-format";

describe("device time formatting", () => {
  it("honors the user's 24-hour clock independently of locale defaults", () => {
    const timestamp = Date.UTC(2026, 7, 20, 18, 24) / 1_000;

    expect(formatTimeForDevice(timestamp, { locale: "en-US", uses24HourClock: true })).not.toMatch(/\b(?:AM|PM)\b/u);
    expect(formatTimeForDevice(timestamp, { locale: "en-US", uses24HourClock: false })).toMatch(/\b(?:AM|PM)\b/u);
  });
});
