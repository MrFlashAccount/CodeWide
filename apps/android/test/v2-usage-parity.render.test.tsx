import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";

import type { V2Item, V2TurnUsage, V2TurnView } from "@codewide/sync-client/v2";

import { liveTurnPlanPresentation } from "../src/v2/features/usage/liveTurnPlanPresentation";
import { latestTurnUsage, usagePresentation } from "../src/v2/features/usage/usagePresentation";
import { CostBreakdownContent } from "../src/v2/presentation/usage/CostBreakdownContent";
import { CostBreakdownPopover } from "../src/v2/presentation/usage/CostBreakdownPopover";
import { LiveTurnPlanContent } from "../src/v2/presentation/usage/LiveTurnPlanContent";
import { LiveTurnPlanPopover } from "../src/v2/presentation/usage/LiveTurnPlanPopover";

const USAGE: V2TurnUsage = {
  cachedInputTokens: 500,
  cacheHit: true,
  cacheWriteInputTokens: 25,
  inputTokens: 1_200,
  latestRequestTokens: 8_000,
  model: "gpt-5.6",
  modelContextWindow: 10_000,
  outputTokens: 300,
  reasoningOutputTokens: 50,
  status: "final",
  threadCachedInputTokens: 8_000,
  threadCacheWriteInputTokens: 200,
  threadCompactionCount: 4,
  threadInputTokens: 20_000,
  threadOutputTokens: 2_000,
  threadReasoningOutputTokens: 250,
  threadTotalCostUsd: 1.25,
  threadTotalTokens: 22_000,
  totalCostUsd: 0.125,
};

describe("V2 usage parity", () => {
  it("preserves every authoritative usage field and the compaction aggregate", () => {
    const presentation = usagePresentation({
      turns: [turn("old", null), turn("current", USAGE)],
    });

    expect(presentation.breakdown).toEqual({
      cacheHit: true,
      compactions: 4,
      context: {
        availableTokens: 2_000,
        model: "gpt-5.6",
        percent: 80,
        totalTokens: 10_000,
        usedTokens: 8_000,
      },
      model: "gpt-5.6",
      session: {
        cachedInputTokens: 8_000,
        cacheWriteInputTokens: 200,
        compactions: 4,
        costUsd: 1.25,
        inputTokens: 20_000,
        outputTokens: 2_000,
        reasoningOutputTokens: 250,
        totalTokens: 22_000,
        uncachedInputTokens: 12_000,
      },
      status: "final",
      turn: {
        cachedInputTokens: 500,
        cacheWriteInputTokens: 25,
        costUsd: 0.125,
        inputTokens: 1_200,
        latestRequestTokens: 8_000,
        outputTokens: 300,
        reasoningOutputTokens: 50,
        totalTokens: 1_500,
        uncachedInputTokens: 700,
      },
    });
  });

  it("returns no made-up usage when no authoritative turn contains it", () => {
    const turns = [turn("one", null), turn("two", null)];

    expect(latestTurnUsage(turns)).toBeNull();
    expect(usagePresentation({ turns })).toEqual({
      breakdown: null,
      context: null,
      session: null,
    });
  });

  it("renders all available cost, context, session, and compaction values", () => {
    const presentation = usagePresentation({ turns: [turn("current", USAGE)] });
    if (presentation.breakdown === null) throw new Error("Expected usage breakdown");

    render(<CostBreakdownContent breakdown={presentation.breakdown} />);

    expect(screen.getByText("gpt-5.6")).toBeTruthy();
    expect(screen.getByLabelText("Latest request: ◇8,000")).toBeTruthy();
    expect(screen.getByLabelText("Available: ◇2,000")).toBeTruthy();
    expect(screen.getByLabelText("Compactions: 4")).toBeTruthy();
    expect(screen.getByLabelText("Input total: ◇1,200")).toBeTruthy();
    expect(screen.getByLabelText("Cached input: ◇500")).toBeTruthy();
    expect(screen.getByLabelText("Cache write: ◇25")).toBeTruthy();
    expect(screen.getByLabelText("Reasoning output: ◇50")).toBeTruthy();
    expect(screen.getByLabelText("Cache hit: Yes")).toBeTruthy();
    expect(screen.getByLabelText("Estimated cost: ≈$0.125")).toBeTruthy();
    expect(screen.getByLabelText("Estimated cost: ≈$1.250")).toBeTruthy();
  });

  it("exposes the cost popover through an accessible trigger", () => {
    const presentation = usagePresentation({ turns: [turn("current", USAGE)] });
    if (presentation.breakdown === null) throw new Error("Expected usage breakdown");

    render(<CostBreakdownPopover breakdown={presentation.breakdown} />);

    expect(
      screen.getByRole("button", { name: "Estimated API-equivalent cost ≈$0.125" }),
    ).toBeTruthy();
  });

  it("does not fabricate a compaction count when the server omits it", () => {
    const usage = { ...USAGE, threadCompactionCount: null };
    const presentation = usagePresentation({ turns: [turn("current", usage)] });
    if (presentation.breakdown === null) throw new Error("Expected usage breakdown");

    render(<CostBreakdownContent breakdown={presentation.breakdown} />);

    expect(screen.queryByText("Compactions")).toBeNull();
    expect(screen.queryByText("Unavailable")).toBeNull();
  });

  it("selects the latest plan from the authoritative running turn", () => {
    const plan = planItem("plan", [
      { status: "completed", text: "Inspect" },
      { status: "running", text: "Implement" },
      { status: "pending", text: "Verify" },
    ]);
    const presentation = liveTurnPlanPresentation([
      turn("completed", null, "completed", [planItem("old", [{ status: "pending", text: "Old" }])]),
      turn("running", null, "running", [plan]),
    ]);

    expect(presentation).toEqual({
      completedSteps: 1,
      currentStep: { id: "plan:1", state: "running", text: "Implement" },
      explanation: null,
      id: "plan",
      steps: [
        { id: "plan:0", state: "completed", text: "Inspect" },
        { id: "plan:1", state: "running", text: "Implement" },
        { id: "plan:2", state: "pending", text: "Verify" },
      ],
    });
  });

  it("does not keep a completed turn plan live", () => {
    const completed = turn("completed", null, "completed", [
      planItem("plan", [{ status: "completed", text: "Done" }]),
    ]);

    expect(liveTurnPlanPresentation([completed])).toBeNull();
  });

  it("renders running plan progress as shimmer-backed live status", () => {
    const plan = liveTurnPlanPresentation([
      turn("running", null, "running", [
        planItem("plan", [
          { status: "completed", text: "Inspect" },
          { status: "running", text: "Implement" },
        ]),
      ]),
    ]);
    if (plan === null) throw new Error("Expected live plan");

    render(
      <>
        <LiveTurnPlanPopover plan={plan} />
        <LiveTurnPlanContent plan={plan} />
      </>,
    );

    expect(screen.getByRole("button", { name: "Plan, 1/2 complete, Implement" })).toBeTruthy();
    expect(screen.getAllByTestId("live-plan-chip-current")).toHaveLength(1);
    expect(screen.getByTestId("live-plan-step-1")).toBeTruthy();
    expect(screen.getByLabelText("Completed: Inspect")).toBeTruthy();
    expect(screen.getByLabelText("In progress: Implement")).toBeTruthy();
  });
});

function turn(
  id: string,
  usage: V2TurnUsage | null,
  state: V2TurnView["state"] = "completed",
  items: V2Item[] = [],
): V2TurnView {
  return {
    activity: null,
    completedAt: state === "completed" ? "2026-09-03T00:00:01.000Z" : null,
    createdAt: "2026-09-03T00:00:00.000Z",
    durationMs: state === "completed" ? 1_000 : null,
    id,
    items,
    lifecycle: [],
    state,
    threadId: "thread",
    usage,
  };
}

function planItem(
  id: string,
  steps: Extract<V2Item, { kind: "plan" }>["steps"],
): Extract<V2Item, { kind: "plan" }> {
  return { id, kind: "plan", steps };
}
