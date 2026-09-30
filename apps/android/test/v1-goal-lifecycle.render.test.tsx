import { fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ThreadGoal, ThreadGoalStatus } from "@codewide/codex-protocol/v0.155.1/v2";

import type { ThreadGoalRow } from "../src/data/workspace-resource-database";
import { GoalFeature } from "../src/features/goal/GoalFeature";

it("pauses an active goal through the status-only lifecycle command", async () => {
  const close = jest.fn();
  const setGoal = jest.fn(async (status: ThreadGoalStatus) => goal(status));
  const screen = render(
    <GoalFeature
      goalResource={goalRow("active")}
      onClearGoal={jest.fn(async () => true)}
      onClose={close}
      onSetGoal={jest.fn(async () => goal("active"))}
      onSetGoalStatus={setGoal}
      visible
      voiceScope="test"
    />,
  );

  expect(screen.getByText("Active")).toBeVisible();
  const pauseButton = screen.getByRole("button", { name: "Pause goal" });
  fireEvent.press(pauseButton);
  fireEvent.press(pauseButton);

  await waitFor(() => expect(setGoal).toHaveBeenCalledWith("paused"));
  expect(setGoal).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
});

it("resumes a blocked goal without rewriting its objective", async () => {
  const close = jest.fn();
  const setGoal = jest.fn(async (status: ThreadGoalStatus) => goal(status));
  const saveGoal = jest.fn(async () => goal("blocked"));
  const screen = render(
    <GoalFeature
      goalResource={goalRow("blocked")}
      onClearGoal={jest.fn(async () => true)}
      onClose={close}
      onSetGoal={saveGoal}
      onSetGoalStatus={setGoal}
      visible
      voiceScope="test"
    />,
  );

  fireEvent.press(screen.getByRole("button", { name: "Resume goal" }));

  await waitFor(() => expect(setGoal).toHaveBeenCalledWith("active"));
  expect(saveGoal).not.toHaveBeenCalled();
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
});

it("keeps terminal and limit statuses read-only", () => {
  const screen = render(
    <GoalFeature
      goalResource={goalRow("complete")}
      onClearGoal={jest.fn(async () => true)}
      onClose={jest.fn()}
      onSetGoal={jest.fn(async () => goal("complete"))}
      onSetGoalStatus={jest.fn(async () => goal("complete"))}
      visible
      voiceScope="test"
    />,
  );

  expect(screen.getByText("Complete")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Pause goal" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Resume goal" })).toBeNull();
});

function goalRow(status: ThreadGoalStatus): ThreadGoalRow {
  return {
    connectionId: "connection",
    error: null,
    goal: goal(status),
    id: "connection\u0000thread",
    status: "ready",
    threadId: "thread",
    updatedAt: 2,
  };
}

function goal(status: ThreadGoalStatus): ThreadGoal {
  return {
    createdAt: 1,
    objective: "Keep the release healthy",
    status,
    threadId: "thread",
    timeUsedSeconds: 90,
    tokenBudget: null,
    tokensUsed: 1_000,
    updatedAt: 2,
  };
}
