import { afterEach, describe, expect, it } from "vitest";

import {
  performanceExperimentEnabled,
  performanceExperimentSnapshot,
  resetPerformanceExperiments,
  resetPerformanceExperimentsForTests,
  setPerformanceExperiment,
} from "../src/data/performance-experiments";

describe("session-only performance experiments", () => {
  afterEach(resetPerformanceExperimentsForTests);

  it("starts safe and changes only the selected subsystem", () => {
    expect(Object.values(performanceExperimentSnapshot())).toEqual([false, false, false, false, false]);

    setPerformanceExperiment("plainTextMarkdown", true);

    expect(performanceExperimentEnabled("plainTextMarkdown")).toBe(true);
    expect(performanceExperimentEnabled("disableTextShimmer")).toBe(false);
    expect(performanceExperimentEnabled("hideThreadLists")).toBe(false);
    expect(performanceExperimentEnabled("skipMarkdownLayout")).toBe(false);
    expect(performanceExperimentEnabled("reduceCustomMotion")).toBe(false);
  });

  it("resets all experiments together when monitoring stops", () => {
    setPerformanceExperiment("hideThreadLists", true);
    setPerformanceExperiment("reduceCustomMotion", true);
    resetPerformanceExperiments();

    expect(Object.values(performanceExperimentSnapshot())).toEqual([false, false, false, false, false]);
  });
});
