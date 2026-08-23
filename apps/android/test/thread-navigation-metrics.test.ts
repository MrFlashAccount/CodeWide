import { afterEach, describe, expect, it } from "vitest";

import {
  beginThreadNavigation,
  activeThreadNavigationIdFor,
  finalizeThreadNavigationProfile,
  getThreadNavigationProfileSnapshot,
  markThreadNavigationStage,
  measureThreadNavigationWork,
  recordThreadNavigationMeasure,
  recordThreadNavigationRowCommit,
  resetThreadNavigationMetricsForTests,
} from "../src/data/thread-navigation-metrics";
import {
  operationalMetricsSnapshot,
  resetOperationalMetricsForTests,
  setOperationalDiagnosticsEnabled,
} from "../src/data/operational-metrics";
import {
  configureTelemetryTransport,
  flushTelemetry,
  resetTelemetryForTests,
  setTelemetryEnabled,
  type TelemetryBatch,
} from "../src/data/telemetry";

describe("thread navigation metrics", () => {
  afterEach(() => {
    resetThreadNavigationMetricsForTests();
    resetOperationalMetricsForTests();
    resetTelemetryForTests();
  });

  it("correlates every stage of one navigation without recording content", async () => {
    const batches: TelemetryBatch[] = [];
    configureTelemetryTransport(async (_connectionId, batch) => { batches.push(batch); });
    setTelemetryEnabled(true);
    setOperationalDiagnosticsEnabled(true);

    const navigationId = beginThreadNavigation("server-1", "thread-1");
    markThreadNavigationStage("server-1", "thread-1", "selection_next_frame", { values: { animationFrameDelayMs: 4 } });
    markThreadNavigationStage("server-1", "thread-1", "hydration_start");
    markThreadNavigationStage("server-1", "thread-1", "hydration_result", {
      values: { rpcMs: 28, itemCount: 3 },
      tags: { outcome: "success" },
    });
    markThreadNavigationStage("server-1", "thread-1", "hydration_result", { values: { rpcMs: 999 } });
    markThreadNavigationStage("server-1", "thread-1", "next_frame", { values: { itemCount: 3 } });
    await flushTelemetry();

    const events = batches.flatMap((batch) => batch.events);
    expect(events.map((event) => event.tags?.stage)).toEqual([
      "selection_requested",
      "selection_next_frame",
      "hydration_start",
      "hydration_result",
      "next_frame",
    ]);
    expect(events.every((event) => event.requestId === navigationId)).toBe(true);
    expect(events.every((event) => event.sessionId === "thread-1" && event.threadId === "thread-1")).toBe(true);
    expect(events[3]).toMatchObject({ values: { rpcMs: 28, itemCount: 3 }, tags: { outcome: "success" } });
    expect(JSON.stringify(events)).not.toMatch(/content|message|payload|prompt|response|text/u);
    expect(operationalMetricsSnapshot().timings.thread_navigation_total_ms?.totalCount).toBe(1);
  });

  it("closes an unfinished navigation as superseded and ignores its late stages", async () => {
    const batches: TelemetryBatch[] = [];
    configureTelemetryTransport(async (_connectionId, batch) => { batches.push(batch); });
    setTelemetryEnabled(true);

    const firstId = beginThreadNavigation("server-1", "thread-1");
    const secondId = beginThreadNavigation("server-1", "thread-2");
    markThreadNavigationStage("server-1", "thread-1", "hydration_result", { tags: { outcome: "aborted" } });
    markThreadNavigationStage("server-1", "thread-2", "next_frame");
    await flushTelemetry();

    const events = batches.flatMap((batch) => batch.events);
    expect(events.filter((event) => event.requestId === firstId).map((event) => event.tags?.stage)).toEqual([
      "selection_requested",
      "superseded",
    ]);
    expect(events.filter((event) => event.requestId === secondId).map((event) => event.tags?.stage)).toEqual([
      "selection_requested",
      "next_frame",
    ]);
  });

  it("rejects a late commit from an older generation of the same thread", () => {
    const firstId = beginThreadNavigation("server-1", "thread-1");
    const secondId = beginThreadNavigation("server-1", "thread-1");

    expect(activeThreadNavigationIdFor("server-1", "thread-1")).toBe(secondId);
    expect(markThreadNavigationStage("server-1", "thread-1", "next_frame", {}, firstId)).toBeNull();
    expect(getThreadNavigationProfileSnapshot().active?.id).toBe(secondId);

    const completed = markThreadNavigationStage("server-1", "thread-1", "next_frame", {}, secondId);
    expect(completed?.id).toBe(secondId);
  });

  it("builds a content-free render profile with committed rows and exact frame stats", async () => {
    const batches: TelemetryBatch[] = [];
    configureTelemetryTransport(async (_connectionId, batch) => { batches.push(batch); });
    setTelemetryEnabled(true);

    const navigationId = beginThreadNavigation("server-1", "thread-3");
    markThreadNavigationStage("server-1", "thread-3", "timeline_model_ready", { values: { itemCount: 12 } });
    recordThreadNavigationRowCommit("server-1", "thread-3", "row-1");
    recordThreadNavigationRowCommit("server-1", "thread-3", "row-1");
    recordThreadNavigationRowCommit("server-1", "thread-3", "row-2");
    recordThreadNavigationMeasure("server-1", "thread-3", "react_workspace_commit", 18, {
      values: { schedulerWaitMs: 4 },
      tags: { phase: "update" },
    });
    expect(measureThreadNavigationWork("server-1", "thread-3", "assemble_timeline", () => 42)).toBe(42);
    const completed = markThreadNavigationStage("server-1", "thread-3", "next_frame");
    expect(completed).not.toBeNull();
    const profile = finalizeThreadNavigationProfile(completed!, {
      durationMs: 42,
      renderedFrames: 3,
      averageFrameMs: 14,
      p95FrameMs: 24,
      maxFrameMs: 24,
      jankFrames: 1,
      droppedFrameEstimate: 1,
      hermesProfile: {
        format: "hermes-sampling-profile",
        sizeBytes: 128,
        content: "{}",
        error: null,
      },
    });
    await flushTelemetry();

    expect(profile).toMatchObject({
      id: navigationId,
      status: "completed",
      rowCommits: 3,
      uniqueRowsCommitted: 2,
      measures: expect.arrayContaining([
        expect.objectContaining({ name: "react_workspace_commit", durationMs: 18 }),
        expect.objectContaining({ name: "assemble_timeline" }),
      ]),
      frames: { renderedFrames: 3, jankFrames: 1 },
    });
    expect(getThreadNavigationProfileSnapshot()).toMatchObject({ last: { id: navigationId, frames: { p95FrameMs: 24 } } });
    const summary = batches.flatMap((batch) => batch.events).find((event) => event.name === "navigation.thread_profile");
    const measures = batches.flatMap((batch) => batch.events).filter((event) => event.name === "navigation.thread_measure");
    expect(summary).toMatchObject({
      requestId: navigationId,
      values: { rowCommits: 3, uniqueRowsCommitted: 2, renderedFrames: 3, jankFrames: 1 },
      tags: { status: "completed", frameTrace: "available" },
    });
    expect(measures).toEqual(expect.arrayContaining([
      expect.objectContaining({ requestId: navigationId, values: expect.objectContaining({ durationMs: 18 }), tags: expect.objectContaining({ measure: "react_workspace_commit" }) }),
      expect.objectContaining({ requestId: navigationId, tags: expect.objectContaining({ measure: "assemble_timeline" }) }),
    ]));
    expect(JSON.stringify(summary)).not.toMatch(/content|message|payload|prompt|response|text/u);
  });
});
