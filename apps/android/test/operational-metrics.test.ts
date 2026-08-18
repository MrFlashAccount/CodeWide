import { afterEach, describe, expect, it } from "vitest";

import { incrementMetric, operationalMetricsSnapshot, recordTiming, resetOperationalMetricsForTests } from "../src/data/operational-metrics";

describe("privacy-safe operational metrics", () => {
  afterEach(resetOperationalMetricsForTests);

  it("keeps bounded aggregate percentiles without accepting arbitrary labels", () => {
    for (let value = 0; value < 300; value += 1) recordTiming("live_reducer_ms", value);
    incrementMetric("live_events", 3);

    expect(operationalMetricsSnapshot()).toMatchObject({
      timings: { live_reducer_ms: { count: 256, maxMs: 299 } },
      counters: { live_events: 3 },
    });
  });

  it("drops invalid values instead of poisoning release percentiles", () => {
    recordTiming("thread_resume_ms", Number.NaN);
    recordTiming("thread_resume_ms", -1);
    expect(operationalMetricsSnapshot().timings.thread_resume_ms).toBeUndefined();
  });
});
