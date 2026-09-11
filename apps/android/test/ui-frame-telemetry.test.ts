import { afterEach, describe, expect, it, vi } from "vitest";

import { configureTelemetryTransport, flushTelemetry, resetTelemetryForTests, setTelemetryEnabled, type TelemetryBatch } from "../src/data/telemetry";
import { publishFrameIncidents, recordFrameContext, recordJsSchedulingDelay, resetFrameContextsForTests } from "../src/data/ui-frame-telemetry";
import { parseWindowFrameReport } from "../src/data/window-frame-report";

function frameWindow(start: number, end: number) {
  return {
    windowStartUnixMs: start, windowEndUnixMs: end,
    frameCount: 20, jankFrameCount: 2, missedVsyncEstimate: 5,
    droppedMetricReports: 1, jankFrameTotalMs: 85, overrunTotalMs: 53,
    maxFrameMs: 60, maxOverrunMs: 44, maxLayoutMs: 20, maxDrawMs: 10,
    maxGpuMs: 5, maxUiDelayMs: 25,
  };
}

describe("operational frame telemetry", () => {
  it("exports only bounded numeric reports and enum surface labels from offline storage", () => {
    const sample = { ...frameWindow(100, 200), surface: "ports", activity: "scroll", appBuild: 145, content: "secret" };
    const parsed = parseWindowFrameReport(JSON.stringify({ version: 1, evictedWindows: 7, unobservedWindows: 1, windows: [sample, { ...sample, surface: "/private/path" }, { ...sample, frameCount: -1 }] }));
    expect(parsed?.windows).toHaveLength(1);
    expect(parsed).toMatchObject({ evictedWindows: 7, unobservedWindows: 1, windows: [{ surface: "ports", activity: "scroll", appBuild: 145 }] });
    expect(JSON.stringify(parsed)).not.toContain("secret");
    expect(parseWindowFrameReport("invalid")).toBeNull();
    expect(parseWindowFrameReport(" ".repeat(1_048_577))).toBeNull();
  });

  it("ships healthy scroll windows separately from generic frame incidents", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100);
    const batches: TelemetryBatch[] = [];
    configureTelemetryTransport(async (_connectionId, batch) => { batches.push(batch); });
    recordFrameContext("server", "chat", "navigation");
    publishFrameIncidents({ windows: [{ ...frameWindow(200, 300), surface: "folders", activity: "scroll", appBuild: 145, jankFrameCount: 0 }], droppedWindows: 0 });
    await flushTelemetry();
    expect(batches[0]?.events[0]).toMatchObject({ name: "ui.scroll_window", tags: { surface: "folders", activity: "scroll" }, values: { appBuild: 145, frameCount: 20, jankFrameCount: 0 } });
  });
  afterEach(() => {
    resetFrameContextsForTests();
    resetTelemetryForTests();
    vi.useRealTimers();
  });

  it("exports delayed native incidents with their original selection while diagnostics are off", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const batches: TelemetryBatch[] = [];
    configureTelemetryTransport(async (_connectionId, batch) => { batches.push(batch); });
    setTelemetryEnabled(false);
    recordFrameContext("server-a", "chat-a", "navigation-a");
    vi.setSystemTime(2_000);
    recordFrameContext("server-b", "chat-b", "navigation-b");
    vi.setSystemTime(5_000);
    publishFrameIncidents({ windows: [frameWindow(1_100, 1_300), frameWindow(2_100, 2_400)], droppedWindows: 0 });
    await flushTelemetry();
    const events = batches.flatMap((batch) => batch.events);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      name: "ui.frame_incident", connectionId: "server-a", threadId: "chat-a", requestId: "navigation-a",
      values: { windowStartUnixMs: 1_100, windowEndUnixMs: 1_300, deliveryDelayMs: 3_700, jankFrameCount: 2, droppedMetricReports: 1 },
    });
    expect(events[1]).toMatchObject({ connectionId: "server-b", threadId: "chat-b", requestId: "navigation-b" });
  });

  it("rejects malformed native input and never forwards unapproved payload fields", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100);
    const batches: TelemetryBatch[] = [];
    configureTelemetryTransport(async (_connectionId, batch) => { batches.push(batch); });
    recordFrameContext("server", "chat", "navigation");
    publishFrameIncidents({ windows: [null, {}, { ...frameWindow(200, 300), maxFrameMs: NaN }, { ...frameWindow(200, 300), content: "secret", url: "secret" }], droppedWindows: 3 });
    await flushTelemetry();
    const events = batches.flatMap((batch) => batch.events);
    expect(events).toHaveLength(2);
    expect(events[0]?.name).toBe("ui.frame_incident");
    expect(events[0]?.values?.maxFrameMs).toBe(60);
    expect(events[1]).toMatchObject({ name: "ui.frame_reports_dropped", values: { windows: 3 } });
    expect(JSON.stringify(events)).not.toContain("secret");
  });

  it("records large JS scheduling delays separately from frame metrics", async () => {
    const batches: TelemetryBatch[] = [];
    configureTelemetryTransport(async (_connectionId, batch) => { batches.push(batch); });
    recordFrameContext("server", "chat", "navigation");
    recordJsSchedulingDelay(12);
    recordJsSchedulingDelay(250);
    await flushTelemetry();
    expect(batches[0]?.events).toEqual([expect.objectContaining({ name: "ui.js_scheduling_delay", values: { delayMs: 250 } })]);
  });
});
