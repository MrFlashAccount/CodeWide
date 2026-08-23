import { afterEach, describe, expect, it, vi } from "vitest";

import {
  incrementDiagnosticMetric,
  incrementMetric,
  liveStreamMetricKey,
  markLiveBatchDelivered,
  operationalMetricsSnapshot,
  recordDiagnosticTiming,
  recordLiveRenderCommit,
  recordSqliteSubsetLoad,
  recordTiming,
  resetOperationalMetricsForTests,
  setOperationalDiagnosticsEnabled,
  setThreadDetailResidentRows,
} from "../src/data/operational-metrics";

describe("privacy-safe operational metrics", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetOperationalMetricsForTests();
  });

  it("keeps bounded aggregate percentiles without accepting arbitrary labels", () => {
    for (let value = 0; value < 300; value += 1) recordTiming("live_reducer_ms", value);
    incrementMetric("live_events", 3);

    expect(operationalMetricsSnapshot()).toMatchObject({
      timings: { live_reducer_ms: { count: 256, totalCount: 300, totalMs: 44_850, maxMs: 299 } },
      counters: { live_events: 3 },
    });
  });

  it("drops invalid values instead of poisoning release percentiles", () => {
    recordTiming("thread_resume_ms", Number.NaN);
    recordTiming("thread_resume_ms", -1);
    expect(operationalMetricsSnapshot().timings.thread_resume_ms).toBeUndefined();
  });

  it("keeps hot-path diagnostics inert until Data for geeks is enabled", () => {
    recordDiagnosticTiming("markdown_parse_ms", 12);
    incrementDiagnosticMetric("markdown_parse_requests");
    expect(operationalMetricsSnapshot()).toEqual({
      timings: {},
      counters: {},
      gauges: {
        livePendingStreams: 0,
        livePendingChars: 0,
        liveOldestPendingMs: 0,
        sqliteSubsetLastRows: 0,
        sqliteSubsetMaxRows: 0,
        threadDetailResidentRows: 0,
      },
    });

    setOperationalDiagnosticsEnabled(true);
    recordDiagnosticTiming("markdown_parse_ms", 12);
    incrementDiagnosticMetric("markdown_parse_requests");
    expect(operationalMetricsSnapshot()).toMatchObject({
      timings: { markdown_parse_ms: { totalCount: 1, totalMs: 12 } },
      counters: { markdown_parse_requests: 1 },
    });
  });

  it("measures first delivered live delta to the next committed render only when enabled", () => {
    const now = vi.spyOn(performance, "now");
    now.mockReturnValue(0);
    const streamKey = liveStreamMetricKey("server", "thread", "turn", "item");
    expect(streamKey).not.toBeNull();

    markLiveBatchDelivered(streamKey!, 3);
    recordLiveRenderCommit(streamKey!);
    expect(operationalMetricsSnapshot().timings.live_delta_to_commit_ms).toBeUndefined();

    now.mockReset().mockReturnValueOnce(10).mockReturnValueOnce(34).mockReturnValue(40);
    setOperationalDiagnosticsEnabled(true);
    markLiveBatchDelivered(streamKey!, 3);
    markLiveBatchDelivered(streamKey!, 5);
    expect(operationalMetricsSnapshot().gauges).toEqual({
      livePendingStreams: 1,
      livePendingChars: 8,
      liveOldestPendingMs: 24,
      sqliteSubsetLastRows: 0,
      sqliteSubsetMaxRows: 0,
      threadDetailResidentRows: 0,
    });
    recordLiveRenderCommit(streamKey!);
    recordLiveRenderCommit(streamKey!);
    expect(operationalMetricsSnapshot()).toMatchObject({
      timings: { live_delta_to_commit_ms: {
        totalCount: 1,
        totalMs: 30,
      } },
      counters: {
        live_projected_batches: 2,
        live_projected_chars: 8,
        live_render_commits: 1,
        live_render_chars: 8,
        live_render_projection_batches: 2,
      },
      gauges: {
        livePendingStreams: 0,
        livePendingChars: 0,
      },
    });
  });

  it("records bounded SQLite subset and resident row counts", () => {
    recordSqliteSubsetLoad(18, 4.5);
    recordSqliteSubsetLoad(6, 1.5);
    setThreadDetailResidentRows(27);

    expect(operationalMetricsSnapshot()).toMatchObject({
      timings: { sqlite_subset_load_ms: { totalCount: 2, totalMs: 6 } },
      counters: { sqlite_subset_loads: 2, sqlite_subset_rows_loaded: 24 },
      gauges: {
        sqliteSubsetLastRows: 6,
        sqliteSubsetMaxRows: 18,
        threadDetailResidentRows: 27,
      },
    });
  });
});
