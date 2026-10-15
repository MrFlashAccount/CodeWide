import { describe, expect, it } from "vitest";

import { shouldShowConversationStatus } from "../src/features/conversation/conversationStatusLayout";

describe("conversation status visibility", () => {
  it.each([
    { expected: true, hasGoal: true, hasLiveTurnPlan: false, hasWorkingAgents: false },
    { expected: true, hasGoal: false, hasLiveTurnPlan: true, hasWorkingAgents: false },
    { expected: true, hasGoal: false, hasLiveTurnPlan: false, hasWorkingAgents: true },
    { expected: true, hasGoal: true, hasLiveTurnPlan: true, hasWorkingAgents: true },
    { expected: false, hasGoal: false, hasLiveTurnPlan: false, hasWorkingAgents: false },
  ])(
    "shows independent goal, live-plan and working-agent contents",
    ({ expected, hasGoal, hasLiveTurnPlan, hasWorkingAgents }) => {
      expect(
        shouldShowConversationStatus({
          hasGoal,
          hasLiveTurnPlan,
          hasWorkingAgents,
          searchActive: false,
          timelinePositioned: true,
        }),
      ).toBe(expected);
    },
  );

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
          hasWorkingAgents: true,
          searchActive,
          timelinePositioned,
        }),
      ).toBe(false);
    },
  );
});
