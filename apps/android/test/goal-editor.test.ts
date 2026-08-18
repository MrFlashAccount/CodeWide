import { describe, expect, it } from "vitest";

import { validateGoalEditorDraft } from "../src/data/goal-editor";

describe("goal editor", () => {
  it("creates an active goal without a budget by default", () => {
    expect(validateGoalEditorDraft("  Ship the Android client  ", "")).toEqual({
      value: { objective: "Ship the Android client", status: "active", tokenBudget: null },
      error: null,
    });
  });

  it("preserves an existing lifecycle status when editing", () => {
    expect(validateGoalEditorDraft("Recover the connection", "4096", "paused")).toEqual({
      value: { objective: "Recover the connection", status: "paused", tokenBudget: 4096 },
      error: null,
    });
  });

  it.each(["0", "-1", "1.5", "not-a-number"])("rejects invalid token budget %s", (budget) => {
    expect(validateGoalEditorDraft("Keep going", budget)).toEqual({
      value: null,
      error: "Token budget must be a positive integer",
    });
  });

  it("requires a non-empty objective", () => {
    expect(validateGoalEditorDraft("   ", "100")).toEqual({
      value: null,
      error: "Goal objective is required",
    });
  });
});
