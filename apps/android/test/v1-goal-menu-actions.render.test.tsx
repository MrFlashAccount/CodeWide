import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ThreadGoal, ThreadGoalStatus } from "@codewide/codex-protocol/v0.155.1/v2";

import { useGoalCommands, type GoalCommands } from "../src/features/goal/goalCommands";
import { useGoalMenu, type GoalMenuCapabilities } from "../src/features/goal/goalMenu";

function goal(status: ThreadGoalStatus = "active"): ThreadGoal {
  return {
    createdAt: 1,
    objective: "Ship the release",
    status,
    threadId: "thread",
    timeUsedSeconds: 90,
    tokenBudget: null,
    tokensUsed: 1000,
    updatedAt: 2,
  };
}

function menuCapabilities(): GoalMenuCapabilities {
  return {
    captureGoalLifecycle: () => ({
      clear: jest.fn(async () => true),
      setStatus: jest.fn(async (status) => goal(status)),
    }),
    currentTurnId: "turn",
    goal: goal(),
    onBeforeOpen: jest.fn(),
    onEdit: jest.fn(),
    onInterrupt: jest.fn(async () => undefined),
  };
}

it("pauses before interruption, clears only after it succeeds, and admits only one Stop", async () => {
  const paused = Promise.withResolvers<ThreadGoal>();
  const interrupted = Promise.withResolvers<void>();
  const setStatus = jest.fn(() => paused.promise);
  const clear = jest.fn(async () => true);
  const interrupt = jest.fn(() => interrupted.promise);
  const hook = renderHook(useGoalMenu, {
    initialProps: {
      ...menuCapabilities(),
      captureGoalLifecycle: () => ({ clear, setStatus }),
      onInterrupt: interrupt,
    },
  });

  act(() => {
    hook.result.current.stop();
    hook.result.current.stop();
    hook.result.current.edit();
  });
  expect(setStatus).toHaveBeenCalledTimes(1);
  expect(setStatus).toHaveBeenCalledWith("paused");
  expect(interrupt).not.toHaveBeenCalled();
  expect(clear).not.toHaveBeenCalled();
  await act(async () => paused.resolve(goal("paused")));
  expect(interrupt).toHaveBeenCalledWith("turn");
  expect(clear).not.toHaveBeenCalled();
  await act(async () => interrupted.resolve());
  expect(clear).toHaveBeenCalledTimes(1);
});

it("finishes a pending Stop on its captured thread and turn after the visible selection changes", async () => {
  const paused = Promise.withResolvers<ThreadGoal>();
  const oldClear = jest.fn(async () => true);
  const oldInterrupt = jest.fn(async () => undefined);
  const newClear = jest.fn(async () => true);
  const newInterrupt = jest.fn(async () => undefined);
  const hook = renderHook(useGoalMenu, {
    initialProps: {
      ...menuCapabilities(),
      captureGoalLifecycle: () => ({ clear: oldClear, setStatus: () => paused.promise }),
      onInterrupt: oldInterrupt,
    },
  });
  act(() => hook.result.current.stop());
  hook.rerender({
    ...menuCapabilities(),
    currentTurnId: "other-turn",
    captureGoalLifecycle: () => ({ clear: newClear, setStatus: async (status) => goal(status) }),
    onInterrupt: newInterrupt,
  });
  await act(async () => paused.resolve(goal("paused")));
  await waitFor(() => expect(oldClear).toHaveBeenCalledTimes(1));
  expect(oldInterrupt).toHaveBeenCalledWith("turn");
  expect(newInterrupt).not.toHaveBeenCalled();
  expect(newClear).not.toHaveBeenCalled();
});

it("removes an idle paused goal without inventing an interruption or status update", async () => {
  const clear = jest.fn(async () => true);
  const setStatus = jest.fn(async (status: "active" | "paused") => goal(status));
  const interrupt = jest.fn(async () => undefined);
  const hook = renderHook(useGoalMenu, {
    initialProps: {
      ...menuCapabilities(),
      captureGoalLifecycle: () => ({ clear, setStatus }),
      currentTurnId: null,
      goal: goal("paused"),
      onInterrupt: interrupt,
    },
  });
  act(() => hook.result.current.stop());
  await waitFor(() => expect(clear).toHaveBeenCalledTimes(1));
  expect(setStatus).not.toHaveBeenCalled();
  expect(interrupt).not.toHaveBeenCalled();
});

it("captures qualified lifecycle commands independently of later connection and thread selection", async () => {
  const remote: GoalCommands = {
    clearThreadGoal: jest.fn(async () => true),
    getThreadGoal: jest.fn(async () => goal()),
    setThreadGoal: jest.fn(async () => goal()),
    setThreadGoalStatus: jest.fn(async () => goal("paused")),
  };
  const hook = renderHook(
    ({ connectionId, threadId }) => useGoalCommands(remote, connectionId, threadId),
    { initialProps: { connectionId: "old-server", threadId: "old-thread" } },
  );
  const captured = hook.result.current.captureGoalLifecycle();
  hook.rerender({ connectionId: "new-server", threadId: "new-thread" });
  await captured.setStatus("paused");
  await captured.clear();
  expect(remote.setThreadGoalStatus).toHaveBeenCalledWith("old-server", "old-thread", "paused");
  expect(remote.clearThreadGoal).toHaveBeenCalledWith("old-server", "old-thread");
  await hook.result.current.captureGoalLifecycle().clear();
  expect(remote.clearThreadGoal).toHaveBeenLastCalledWith("new-server", "new-thread");
});
