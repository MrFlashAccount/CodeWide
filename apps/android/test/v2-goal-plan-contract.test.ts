import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const legacyPlanPopover = readFileSync(
  new URL("../src/ui/LiveTurnPlanPopover.tsx", import.meta.url),
  "utf8",
);
const v2PlanPopover = readFileSync(
  new URL("../src/v2/presentation/usage/LiveTurnPlanPopover.android.tsx", import.meta.url),
  "utf8",
);
const v2Conversation = readFileSync(
  new URL("../src/v2/features/conversation/ConversationScreen.tsx", import.meta.url),
  "utf8",
);
const legacyConversation = readFileSync(
  new URL("../src/CodeWideScreen.tsx", import.meta.url),
  "utf8",
);

describe("goal and plan presentation contract", () => {
  it("keeps both native plan popovers vertically scrollable", () => {
    expect(legacyPlanPopover).toContain("nestedScrollEnabled");
    expect(v2PlanPopover).toContain("nestedScrollEnabled");
    expect(v2PlanPopover).toContain('testID="live-plan-popover"');
  });

  it("projects the V2 goal beside live plan status and opens its details", () => {
    expect(v2Conversation).toContain('kind: "thread.goal"');
    expect(v2Conversation).toContain("<ThreadGoalChip goal={goal} onPress={onOpenGoal} />");
    expect(v2Conversation).toContain("<ThreadGoalSheet");
  });

  it("loads and projects the legacy goal beside live plan status", () => {
    expect(legacyConversation).toContain('"conversation-thread-goal"');
    expect(legacyConversation).toContain(
      "<ThreadGoalChip goal={currentGoal} onPress={openGoalDetails} />",
    );
    expect(legacyConversation).toContain('testID="thread-goal-details"');
  });
});
