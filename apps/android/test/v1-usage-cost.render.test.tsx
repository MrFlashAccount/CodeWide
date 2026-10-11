import { describe, expect, it } from "@jest/globals";
import type { TurnUsageProjection } from "@codewide/sync-client";
import { render } from "@testing-library/react-native";

import { CostBreakdownContent } from "../src/features/accounts/CostBreakdownContent";
import { TurnFooter } from "../src/features/conversation/turns/TurnFooter";
import type { TokenCostEstimate } from "../src/turn-cost";

const counts = {
  totalTokens: 1_420,
  inputTokens: 1_400,
  cachedInputTokens: 1_000,
  cacheWriteInputTokens: 300,
  outputTokens: 20,
  reasoningOutputTokens: 0,
};

const reported: TokenCostEstimate = {
  basis: "providerReported",
  model: "claude-sonnet-4-6",
  pricingVersion: "list",
  currency: "USD",
  uncachedInputTokens: 100,
  cachedInputTokens: 1_000,
  cacheWriteInputTokens: 300,
  outputTokens: 20,
  cacheHitPercent: 71.4,
  totalCostUsd: 0.0123,
};

function usage(cost: TokenCostEstimate | null): TurnUsageProjection {
  return {
    version: 1,
    status: "final",
    modelContextWindow: 200_000,
    latestRequest: counts,
    turn: { tokens: counts, cost },
    thread: { tokens: counts, cost },
  };
}

describe("usage cost presentation", () => {
  it("labels an agent-reported cost as an estimate with token counts and only its total", () => {
    const view = render(<CostBreakdownContent estimate={reported} />);
    expect(view.getByText("claude-sonnet-4-6")).toBeTruthy();
    expect(view.getByText("Cache write")).toBeTruthy();
    expect(view.getByText("Estimated total")).toBeTruthy();
    expect(view.getByText(/Estimate reported by the agent from its list prices/)).toBeTruthy();
    expect(view.queryByText(/API-equivalent/)).toBeNull();
  });

  it("says the cost is unavailable when a finished turn's usage has no price", () => {
    const view = render(
      <TurnFooter
        completedAt={null}
        durationMs={1_000}
        model="claude-sonnet-4-6"
        status="completed"
        usage={usage(null)}
      />,
    );
    expect(view.getByLabelText("Cost not available for claude-sonnet-4-6")).toBeTruthy();
    expect(view.getByText("cost n/a")).toBeTruthy();
    view.rerender(<TurnFooter completedAt={null} durationMs={1_000} status="completed" usage={null} />);
    expect(view.queryByText("cost n/a")).toBeNull();
  });
});
