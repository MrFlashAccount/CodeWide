import { describe, expect, it } from "vitest";

import {
  commandActivityInput,
  commandActivityTitle,
  commandOutputFootprint,
} from "../src/rendering/command-activity";

describe("command activity presentation", () => {
  it("preserves the exact command for display and copy while bounding only its header", () => {
    const command = `fish -lc '${"long argument ".repeat(20)}'`;
    expect(commandActivityInput({ command }, "fallback")).toBe(command);
    expect(commandActivityTitle(command)).toHaveLength(120);
    expect(commandActivityTitle(command)).toMatch(/…$/u);
    expect(commandActivityInput({}, "fallback")).toBe("fallback");
  });

  it("shows only server figures and never estimates from command output", () => {
    const projected = {
      version: 1,
      basis: "approxBytesPerToken",
      bytes: 400,
      estimatedTokens: 137,
      estimatedInputCostUsd: 0.125,
    };
    expect(
      commandOutputFootprint({
        codewideOutputFootprint: projected,
        aggregatedOutput: "short preview",
      }),
    ).toEqual(projected);
    expect(commandOutputFootprint({ aggregatedOutput: "λa" })).toBeNull();
    expect(
      commandOutputFootprint({ codewideOutputFootprint: { ...projected, estimatedTokens: -1 } }),
    ).toBeNull();
    expect(
      commandOutputFootprint({
        codewideOutputFootprint: { ...projected, estimatedInputCostUsd: null },
      }),
    ).toEqual({ ...projected, estimatedInputCostUsd: null });
  });
});
