import { describe, expect, it } from "vitest";

import { shouldShowConversationStatus } from "../src/features/conversation/conversationStatusLayout";

describe("conversation status visibility", () => {
  it.each([
    { expected: true, hasGoal: true, hasLiveTurnPlan: false },
    { expected: true, hasGoal: false, hasLiveTurnPlan: true },
    { expected: true, hasGoal: true, hasLiveTurnPlan: true },
    { expected: false, hasGoal: false, hasLiveTurnPlan: false },
  ])("shows independent goal and live-plan contents", ({ expected, hasGoal, hasLiveTurnPlan }) => {
    expect(
      shouldShowConversationStatus({
        hasGoal,
        hasLiveTurnPlan,
        searchActive: false,
        timelinePositioned: true,
      }),
    ).toBe(expected);
  });

  it.each([
    { searchActive: true, timelinePositioned: true },
    { searchActive: false, timelinePositioned: false },
  ])(
    "keeps the status hidden outside a ready conversation",
    ({ searchActive, timelinePositioned }) => {
      expect(
        shouldShowConversationStatus({
          hasGoal: true,
          hasLiveTurnPlan: true,
          searchActive,
          timelinePositioned,
        }),
      ).toBe(false);
    },
  );
});
