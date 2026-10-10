/** The recorded model of a session and its catalog id. */

import { describe, expect, it } from "vitest";
import { catalogModelId } from "../src/catalog/models.js";
import { lastRecordedModel } from "../src/history/recordedModel.js";

const assistant = (model: string, parentToolUseId: string | null = null) => ({
  message: { model, role: "assistant" },
  parent_tool_use_id: parentToolUseId,
  type: "assistant",
});

describe("recorded model", () => {
  it("is the newest main-loop answer's model", () => {
    expect(
      lastRecordedModel([
        assistant("claude-sonnet-4-6"),
        assistant("claude-opus-5-5"),
        assistant("claude-haiku-5-5", "toolu_1"),
        assistant("<synthetic>"),
        { message: { content: "next" }, type: "user" },
      ]),
    ).toBe("claude-opus-5-5");
    expect(lastRecordedModel([{ type: "user" }])).toBeNull();
  });

  it("maps to the alias row that resolves to it, never to `default`", () => {
    const models = [
      {
        description: "",
        displayName: "Default",
        resolvedModel: "claude-opus-5-5",
        supportedEffortLevels: [],
        value: "default",
      },
      {
        description: "",
        displayName: "Opus",
        resolvedModel: "claude-opus-5-5",
        supportedEffortLevels: [],
        value: "opus",
      },
      {
        description: "",
        displayName: "Sonnet",
        supportedEffortLevels: [],
        value: "claude-sonnet-4-6",
      },
    ];
    expect(catalogModelId(models, "claude-opus-5-5")).toBe("opus");
    expect(catalogModelId(models, "claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
    expect(catalogModelId(models, "claude-unknown-1")).toBe("claude-unknown-1");
  });
});
