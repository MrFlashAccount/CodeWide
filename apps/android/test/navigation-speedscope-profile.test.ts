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
    expect(result.profiles).toHaveLength(3);
    expect(result.profiles[0]).toMatchObject({
      type: "evented",
      name: "Navigation stages",
      startValue: 0,
      endValue: 950.01,
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
    expect(result.profiles[2]).toMatchObject({
      type: "evented",
      name: "Visible UI states",
      startValue: 0,
      endValue: 950.01,
      events: [
        { type: "O", at: 950, frame: 3 },
        { type: "C", at: 950.01, frame: 3 },
      ],
    });
    expect(result.shared.frames[3]).toEqual({
      name: "suspense_fallback_visible",
      file: "status=loading-history",
    });
  });

  it("serializes same-commit UI markers as an ordered non-overlapping event stack", () => {
    const input: ThreadNavigationProfile = {
      ...profile(),
      visualEvents: [
        { name: "first", elapsedMs: 10, values: {}, tags: {} },
        { name: "second", elapsedMs: 10.001, values: {}, tags: {} },
        { name: "third", elapsedMs: 9.999, values: {}, tags: {} },
      ],
    };
    const result = JSON.parse(serializeNavigationSpeedscopeProfile(input)) as {
      profiles: Array<{ name: string; events?: Array<{ type: "O" | "C"; at: number }> }>;
    };
    const events = result.profiles.find(({ name }) => name === "Visible UI states")?.events ?? [];
    expect(events).toHaveLength(6);
    expect(events.every((event, index) => index === 0 || event.at >= events[index - 1]!.at)).toBe(true);
    expect(events.map(({ type }) => type)).toEqual(["O", "C", "O", "C", "O", "C"]);
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
    visualEvents: [{
      name: "suspense_fallback_visible",
      elapsedMs: 950,
      values: {},
      tags: { status: "loading-history" },
    }],
    frames: null,
  };
}
