import { describe, expect, it } from "vitest";

import { serializeNavigationSpeedscopeProfile } from "../src/data/navigation-speedscope-profile";
import type { ThreadNavigationProfile } from "../src/data/thread-navigation-metrics";

describe("navigation Speedscope projection", () => {
  it("exports sequential stages and measured work using Speedscope's standard format", () => {
    const result = JSON.parse(serializeNavigationSpeedscopeProfile(profile())) as {
      $schema: string;
      profiles: Array<Record<string, unknown>>;
      shared: { frames: Array<{ name: string; file?: string }> };
    };

    expect(result.$schema).toBe("https://www.speedscope.app/file-format-schema.json");
    expect(result.profiles).toHaveLength(2);
    expect(result.profiles[0]).toMatchObject({
      type: "evented",
      name: "Navigation stages",
      startValue: 0,
      endValue: 900,
      events: [
        { type: "O", at: 0, frame: 0 },
        { type: "C", at: 100, frame: 0 },
        { type: "O", at: 100, frame: 1 },
        { type: "C", at: 900, frame: 1 },
      ],
    });
    expect(result.profiles[1]).toMatchObject({
      type: "sampled",
      name: "Measured work",
      samples: [[2]],
      weights: [16.5],
      endValue: 16.5,
    });
    expect(result.shared.frames[2]).toEqual({
      name: "db_materialize_sealed_turns",
      file: "durationMs=16.5 · completedAtMs=210 · rowCount=258 · cache=miss",
    });
  });
});

function profile(): ThreadNavigationProfile {
  return {
    id: "navigation-1",
    connectionId: "connection-1",
    threadId: "thread-1",
    trigger: "thread_list",
    status: "completed",
    startedAtMs: 0,
    totalMs: 900,
    currentStage: "timeline_model_ready",
    bottleneckStage: "timeline_model_ready",
    bottleneckMs: 800,
    rowCommits: 1,
    uniqueRowsCommitted: 1,
    stages: [
      { stage: "scope_commit", elapsedMs: 100, sincePreviousMs: 100, values: {}, tags: {} },
      { stage: "timeline_model_ready", elapsedMs: 900, sincePreviousMs: 800, values: {}, tags: {} },
    ],
    measures: [{
      name: "db_materialize_sealed_turns",
      durationMs: 16.5,
      elapsedMs: 210,
      values: { rowCount: 258 },
      tags: { cache: "miss" },
    }],
    frames: null,
  };
}
