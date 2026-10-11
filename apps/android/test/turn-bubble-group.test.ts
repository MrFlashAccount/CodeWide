import { describe, expect, it } from "vitest";
import type { TurnUsageProjection } from "@codewide/sync-client";

import { combinedTurnUsage } from "../src/features/conversation/turns/turnBubbleGroup";

const tokens = (input: number, output: number) => ({
  cacheWriteInputTokens: 0,
  cachedInputTokens: 0,
  inputTokens: input,
  outputTokens: output,
  reasoningOutputTokens: 0,
  totalTokens: input + output,
});

function usage(input: number, output: number, costUsd: number | null, pricingVersion: "list" | "managed" = "list"): TurnUsageProjection {
  return {
    latestRequest: tokens(input, output),
    modelContextWindow: 200_000,
    status: "final",
    thread: { cost: null, tokens: tokens(input * 10, output * 10) },
    turn: {
      cost:
        costUsd === null
          ? null
          : {
              basis: "providerReported",
              cacheHitPercent: 0,
              cacheWriteInputTokens: 0,
              cachedInputTokens: 0,
              currency: "USD",
              model: "claude-opus-5-5",
              outputTokens: output,
              pricingVersion,
              totalCostUsd: costUsd,
              uncachedInputTokens: input,
            },
      tokens: tokens(input, output),
    },
    version: 1,
  };
}

describe("combined turn usage", () => {
  it("adds the turns' tokens and same-basis costs and keeps the latest thread scope", () => {
    const combined = combinedTurnUsage([usage(100, 10, 0.5), usage(40, 4, 0.25)]);
    expect(combined?.turn.tokens).toEqual(tokens(140, 14));
    expect(combined?.turn.cost).toMatchObject({ basis: "providerReported", totalCostUsd: 0.75, uncachedInputTokens: 140 });
    expect(combined?.thread.tokens).toEqual(tokens(400, 40));
  });

  it("leaves the cost unknown when any turn's cost is unknown or priced differently", () => {
    expect(combinedTurnUsage([usage(100, 10, 0.5), usage(40, 4, null)])?.turn.cost).toBeNull();
    expect(combinedTurnUsage([usage(100, 10, 0.5), usage(40, 4, 0.2, "managed")])?.turn.cost).toBeNull();
  });

  it("knows no usage when a turn's usage is unknown", () => {
    expect(combinedTurnUsage([usage(100, 10, 0.5), null])).toBeNull();
  });
});
