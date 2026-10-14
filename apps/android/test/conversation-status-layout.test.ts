import { describe, expect, it } from "vitest";

import { shouldShowConversationStatus } from "../src/features/conversation/conversationStatusLayout";

describe("conversation status visibility", () => {
  it.each([
    { expected: true, hasGoal: true, hasLiveTurnPlan: false, hasRunningAgents: false },
    { expected: true, hasGoal: false, hasLiveTurnPlan: true, hasRunningAgents: false },
    { expected: true, hasGoal: false, hasLiveTurnPlan: false, hasRunningAgents: true },
    { expected: true, hasGoal: true, hasLiveTurnPlan: true, hasRunningAgents: true },
    { expected: false, hasGoal: false, hasLiveTurnPlan: false, hasRunningAgents: false },
  ])("shows independent goal, live-plan and running-agent contents", (contents) => {
    expect(
      shouldShowConversationStatus({
        hasGoal: contents.hasGoal,
        hasLiveTurnPlan: contents.hasLiveTurnPlan,
        hasRunningAgents: contents.hasRunningAgents,
        searchActive: false,
        timelinePositioned: true,
      }),
    ).toBe(contents.expected);
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
          hasRunningAgents: true,
          searchActive,
          timelinePositioned,
        }),
      ).toBe(false);
    },
  );
});
