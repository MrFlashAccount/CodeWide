import { describe, expect, it } from "vitest";

import { reasoningActivityTitle } from "../src/rendering/reasoning-title";

describe("reasoning activity title", () => {
  it("uses the latest visible line while reasoning is active", () => {
    expect(reasoningActivityTitle("Reviewing state\n\n- Planning redesign…", "inProgress"))
      .toBe("Planning redesign…");
  });

  it("ignores trailing code fences", () => {
    expect(reasoningActivityTitle("## Inspecting layout\n```", "running"))
      .toBe("Inspecting layout");
  });

  it("falls back for empty or settled reasoning", () => {
    expect(reasoningActivityTitle("", "inProgress")).toBe("Thinking");
    expect(reasoningActivityTitle("Planning redesign…", "completed")).toBe("Thinking");
  });
});
