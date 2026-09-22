import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, within } from "@testing-library/react-native";

import type { ThreadGoal } from "@codewide/codex-protocol/v0.155.1/v2";
import { ThreadGoalChip as LegacyThreadGoalChip } from "../src/features/goal/ThreadGoalChip";

describe("thread goal chip", () => {
  it("renders the authoritative status and duration and opens the editor", () => {
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
    expect(screen.queryByText("Ship goal UI")).toBeNull();
    expect(within(chips[0]!).queryByText("Ship goal UI")).toBeNull();
    expect(within(chips[0]!).getByText("Active")).toBeTruthy();
    expect(within(chips[0]!).getByText("1m 30s")).toBeTruthy();
    expect(chips[0]!.props.accessibilityLabel).toBe("Goal, Active, 1m 30s");
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
