import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { formatTimeForDevice } from "../src/data/device-time-format";

const nativeModule = readFileSync(
  new URL("../android/app/src/main/java/dev/codewide/app/remote/CodeWideModule.kt", import.meta.url),
  "utf8",
);

describe("device time formatting", () => {
  it("honors the user's 24-hour clock independently of locale defaults", () => {
    const timestamp = Date.UTC(2026, 7, 20, 18, 24) / 1_000;

    expect(formatTimeForDevice(timestamp, { locale: "en-US", uses24HourClock: true })).not.toMatch(/\b(?:AM|PM)\b/u);
    expect(formatTimeForDevice(timestamp, { locale: "en-US", uses24HourClock: false })).toMatch(/\b(?:AM|PM)\b/u);
  });

  it("reads both locale and 12/24-hour preference from Android", () => {
    expect(nativeModule).toContain('"localeTag" to (context.resources.configuration.locales[0] ?: Locale.getDefault()).toLanguageTag()');
    expect(nativeModule).toContain('"uses24HourClock" to DateFormat.is24HourFormat(context)');
  });
});
