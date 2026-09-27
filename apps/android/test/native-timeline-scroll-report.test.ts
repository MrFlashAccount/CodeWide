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

const geometry = {
  alpha: 1,
  contentAlpha: 1,
  contentChildren: 4,
  contentHeightPx: 19025,
  imeBottomPx: 0,
  kind: "geometry",
  offsetPx: 181,
  phase: "draw",
  sequence: 3,
  shown: true,
  unixMs: 1_790_455_517_322,
  uptimeMs: 1234,
  viewTag: 22782,
  viewportHeightPx: 1786,
};
const frame = {
  deadlineMs: 16.7,
  drawMs: 3,
  droppedReports: 1,
  durationMs: 22,
  gpuMs: -1,
  kind: "frame",
  layoutMs: 5,
  sequence: 4,
  uiDelayMs: 2,
  unixMs: 1_790_455_517_323,
  uptimeMs: 1235,
};
const detailedReport = {
  appBuild: 222,
  appVersion: "0.2.209",
  density: 2.3375,
  evicted: 0,
  incidents: [incident],
  listening: true,
  trace: {
    captures: [{ entries: [geometry, frame], triggerSequence: 3 }],
    drawCount: 1,
    entries: [geometry, frame],
    evicted: 0,
    evictedCaptures: 0,
    frameCount: 1,
    geometryCount: 1,
  },
  trackedViews: 1,
  version: 2,
};

describe("detailed native timeline evidence", () => {
  it("preserves build, native geometry, frame timings and missing GPU evidence without private fields", () => {
    const result = parseNativeTimelineScrollReport({
      ...detailedReport,
      trace: {
        ...detailedReport.trace,
        entries: [
          { ...geometry, message: "PRIVATE" },
          { ...frame, url: "PRIVATE" },
        ],
        captures: [
          {
            entries: [{ ...geometry, children: "PRIVATE" }, frame],
            triggerSequence: 3,
            text: "PRIVATE",
          },
        ],
      },
    });
    expect(result).toEqual(detailedReport);
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });

  it("keeps build and explicit zero coverage even when no timeline was measured", () => {
    const result = parseNativeTimelineScrollReport({
      ...detailedReport,
      incidents: [],
      trackedViews: 0,
      density: 0,
      trace: {
        ...detailedReport.trace,
        captures: [],
        entries: [],
        frameCount: 0,
        drawCount: 0,
        geometryCount: 0,
      },
    });
    expect(result).toMatchObject({
      version: 2,
      appBuild: 222,
      trackedViews: 0,
      trace: { frameCount: 0, entries: [] },
    });
  });

  it.each([
    { ...geometry, phase: "PRIVATE" },
    { ...geometry, offsetPx: Number.NaN },
    { ...geometry, alpha: 2 },
    { ...geometry, viewTag: -1 },
    { ...frame, kind: "PRIVATE" },
    { ...frame, gpuMs: -2 },
    { ...frame, droppedReports: 0.5 },
    { ...frame, durationMs: Infinity },
  ])("rejects invalid native observations instead of copying raw data", (entry) => {
    expect(
      parseNativeTimelineScrollReport({
        ...detailedReport,
        trace: { ...detailedReport.trace, entries: [entry] },
      }),
    ).toBeNull();
  });

  it("rejects over-capacity history, captures and unvalidated build identifiers", () => {
    for (const trace of [
      { ...detailedReport.trace, entries: Array.from({ length: 241 }, () => geometry) },
      {
        ...detailedReport.trace,
        captures: Array.from({ length: 5 }, () => detailedReport.trace.captures[0]),
      },
      {
        ...detailedReport.trace,
        captures: [{ triggerSequence: 3, entries: Array.from({ length: 161 }, () => frame) }],
      },
    ]) {
      expect(parseNativeTimelineScrollReport({ ...detailedReport, trace })).toBeNull();
    }
    expect(
      parseNativeTimelineScrollReport({ ...detailedReport, appVersion: "PRIVATE URL" }),
    ).toBeNull();
  });
});
