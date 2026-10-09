import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, within } from "@testing-library/react-native";

import type { ThreadGoal } from "@codewide/codex-protocol/v0.155.1/v2";
import { ThreadGoalChip as LegacyThreadGoalChip } from "../src/features/goal/ThreadGoalChip";

describe("thread goal chip", () => {
  it("keeps the chip compact, announces its objective and opens goal details", () => {
    const openLegacy = jest.fn();
    render(
      <>
        <LegacyThreadGoalChip goal={legacyGoal()} onPress={openLegacy} />
      </>,
    );

    const chips = screen.getAllByTestId("thread-goal-chip");
    expect(chips).toHaveLength(1);
    fireEvent.press(chips[0]!);

    expect(openLegacy).toHaveBeenCalledTimes(1);
    expect(within(chips[0]!).getByText("Goal")).toBeTruthy();
    expect(within(chips[0]!).queryByText("Ship goal UI")).toBeNull();
    expect(within(chips[0]!).getByText("Active")).toBeTruthy();
    expect(within(chips[0]!).queryByText("1m 30s")).toBeNull();
    expect(chips[0]!.props.accessibilityLabel).toBe("Goal, Active, Ship goal UI");
  });
});

function legacyGoal(): ThreadGoal {
  return {
    createdAt: 1,
    objective: "Ship goal UI",
    status: "active",
    threadId: "thread-1",
    timeUsedSeconds: 90,
    tokenBudget: 20_000,
    tokensUsed: 5_000,
    updatedAt: 2,
  };
}
