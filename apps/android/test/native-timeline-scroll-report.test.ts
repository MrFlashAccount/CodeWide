import { describe, expect, it } from "vitest";
import { parseNativeTimelineScrollReport } from "../src/data/nativeTimelineScrollReport";

const incident = {
  contentHeightPx: 6023,
  elapsedMs: 16,
  fromOffsetPx: 5039,
  source: "content-offset-prop",
  stack: ["com.facebook.react.views.scroll.ReactScrollView.setContentOffset:1336"],
  toOffsetPx: 0,
  unixMs: 1_790_424_339_000,
  viewTag: 101,
  viewportHeightPx: 983,
};

describe("native timeline scroll report boundary", () => {
  it("exports bounded geometry and call sites while dropping undeclared native fields", () => {
    const report = parseNativeTimelineScrollReport({
      evicted: 2,
      incidents: [{ ...incident, text: "PRIVATE", url: "PRIVATE" }],
      secret: "PRIVATE",
      version: 1,
    });
    expect(report).toEqual({ evicted: 2, incidents: [incident], version: 1 });
    expect(JSON.stringify(report)).not.toContain("PRIVATE");
  });

  it.each([
    { ...incident, stack: ["PRIVATE message or URL"] },
    { ...incident, stack: Array.from({ length: 33 }, () => incident.stack[0]) },
    { ...incident, fromOffsetPx: Number.NaN },
    { ...incident, source: "unvalidated-source" },
    { ...incident, viewportHeightPx: -1 },
  ])("rejects malformed or unsafe incidents", (invalid) => {
    expect(
      parseNativeTimelineScrollReport({ evicted: 0, incidents: [invalid], version: 1 }),
    ).toBeNull();
  });

  it("bounds the report and rejects unknown versions", () => {
    expect(
      parseNativeTimelineScrollReport({
        evicted: 0,
        incidents: Array.from({ length: 13 }, () => incident),
        version: 1,
      }),
    ).toBeNull();
    expect(parseNativeTimelineScrollReport({ evicted: 0, incidents: [], version: 2 })).toBeNull();
    expect(parseNativeTimelineScrollReport(null)).toBeNull();
  });
});
