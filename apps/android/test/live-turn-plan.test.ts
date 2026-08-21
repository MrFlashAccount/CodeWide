import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { describe, expect, it } from "vitest";

import { liveTurnPlanProgress, selectLiveTurnPlan } from "../src/rendering/live-turn-plan";

function threadWithPlan(status: "inProgress" | "completed" = "inProgress"): Thread {
  return {
    turns: [{
      id: "turn-1",
      status,
      codewide: {
        plan: {
          explanation: "Ship safely",
          steps: [
            { step: "Inspect", status: "completed" },
            { step: "Implement", status: "inProgress" },
            { step: "Verify", status: "pending" },
          ],
        },
      },
    }],
  } as unknown as Thread;
}

describe("live turn plan", () => {
  it("selects only a non-empty plan from the active turn", () => {
    const thread = threadWithPlan();
    expect(selectLiveTurnPlan(thread, "turn-1")).toMatchObject({ explanation: "Ship safely" });
    expect(selectLiveTurnPlan(thread, "other")).toBeNull();
    expect(selectLiveTurnPlan(threadWithPlan("completed"), "turn-1")).toBeNull();
    expect(selectLiveTurnPlan(thread, null)).toBeNull();
  });

  it("reports progress and prefers the in-progress step", () => {
    const plan = selectLiveTurnPlan(threadWithPlan(), "turn-1");
    expect(plan).not.toBeNull();
    expect(liveTurnPlanProgress(plan!)).toEqual({
      completed: 1,
      current: { step: "Implement", status: "inProgress" },
    });
  });
});
