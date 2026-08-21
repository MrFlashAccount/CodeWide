import { afterEach, describe, expect, it } from "vitest";

import {
  beginThreadNavigation,
  finalizeThreadNavigationProfile,
  getThreadNavigationProfileSnapshot,
  markThreadNavigationStage,
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
    markThreadNavigationStage("server-1", "thread-1", "selection_commit", { values: { reactCommitMs: 4 } });
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
      "selection_commit",
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

  it("builds a content-free render profile with committed rows and exact frame stats", async () => {
    const batches: TelemetryBatch[] = [];
    configureTelemetryTransport(async (_connectionId, batch) => { batches.push(batch); });
    setTelemetryEnabled(true);

    const navigationId = beginThreadNavigation("server-1", "thread-3");
    markThreadNavigationStage("server-1", "thread-3", "timeline_model_ready", { values: { itemCount: 12 } });
    recordThreadNavigationRowCommit("server-1", "thread-3", "row-1");
    recordThreadNavigationRowCommit("server-1", "thread-3", "row-1");
    recordThreadNavigationRowCommit("server-1", "thread-3", "row-2");
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
    });
    await flushTelemetry();

    expect(profile).toMatchObject({
      id: navigationId,
      status: "completed",
      rowCommits: 3,
      uniqueRowsCommitted: 2,
      frames: { renderedFrames: 3, jankFrames: 1 },
    });
    expect(getThreadNavigationProfileSnapshot()).toMatchObject({ last: { id: navigationId, frames: { p95FrameMs: 24 } } });
    const summary = batches.flatMap((batch) => batch.events).find((event) => event.name === "navigation.thread_profile");
    expect(summary).toMatchObject({
      requestId: navigationId,
      values: { rowCommits: 3, uniqueRowsCommitted: 2, renderedFrames: 3, jankFrames: 1 },
      tags: { status: "completed", frameTrace: "available" },
    });
    expect(JSON.stringify(summary)).not.toMatch(/content|message|payload|prompt|response|text/u);
  });
});
