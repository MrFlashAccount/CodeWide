import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen, within } from "@testing-library/react-native";

import type { ThreadGoal } from "@codewide/codex-protocol/v0.147.0/v2";
import type { V2ThreadGoal } from "@codewide/sync-client/v2";
import { ThreadGoalChip as LegacyThreadGoalChip } from "../src/ui/ThreadGoalChip";
import { ThreadGoalChip as V2ThreadGoalChip } from "../src/v2/presentation/goal/threadGoalChip";

describe("thread goal chip", () => {
  it("renders the authoritative status and duration and opens the editor", () => {
    const openLegacy = jest.fn();
    const openV2 = jest.fn();
    render(
      <>
        <LegacyThreadGoalChip goal={legacyGoal()} onPress={openLegacy} />
        <V2ThreadGoalChip goal={v2Goal()} onPress={openV2} />
      </>,
    );

    const chips = screen.getAllByTestId("thread-goal-chip");
    expect(chips).toHaveLength(2);
    fireEvent.press(chips[0]!);
    fireEvent.press(chips[1]!);

    expect(openLegacy).toHaveBeenCalledTimes(1);
    expect(openV2).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText("Ship goal UI")).toHaveLength(1);
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

function v2Goal(): V2ThreadGoal {
  return {
    createdAtMs: 1,
    objective: "Ship goal UI",
    status: "active",
    threadId: "thread-1",
    timeUsedSeconds: 90,
    tokenBudget: 20_000,
    tokensUsed: 5_000,
    updatedAtMs: 2,
  };
}
