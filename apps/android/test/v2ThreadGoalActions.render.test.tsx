import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { useState } from "react";

import type { V2ThreadGoal } from "@codewide/sync-client/v2";
import { ThreadGoalSheetView } from "../src/v2/presentation/goal/ThreadGoalSheetView";

describe("V2 thread goal mutation states", () => {
  it("restores save after rejection and keeps the editor open", async () => {
    const save = deferred<void>();
    const onClose = jest.fn();
    const onSave = jest.fn(() => save.promise);
    render(<GoalHarness goal={null} onClose={onClose} onSave={onSave} />);

    fireEvent.changeText(screen.getByLabelText("Goal objective"), "Ship V2");
    fireEvent.press(screen.getByLabelText("Create goal"));
    expect(screen.getByLabelText("Create goal").props.accessibilityState.busy).toBe(true);

    await act(async () => save.reject(new Error("Goal write failed")));

    expect(screen.getByText("Goal write failed")).toBeTruthy();
    expect(screen.getByLabelText("Create goal").props.accessibilityState.busy).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("restores clear after rejection and preserves confirmation", async () => {
    const clear = deferred<void>();
    const onClose = jest.fn();
    const onClear = jest.fn(() => clear.promise);
    render(<GoalHarness goal={goalFixture()} onClear={onClear} onClose={onClose} />);

    fireEvent.press(screen.getByLabelText("Clear goal"));
    fireEvent.press(screen.getByLabelText("Confirm clear goal"));
    expect(screen.getByLabelText("Confirm clear goal").props.accessibilityState.busy).toBe(true);

    await act(async () => clear.reject(new Error("Goal clear failed")));

    expect(screen.getByText("Goal clear failed")).toBeTruthy();
    expect(screen.getByLabelText("Confirm clear goal").props.accessibilityState.busy).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });
});

interface GoalHarnessProps {
  goal: V2ThreadGoal | null;
  onClear?(): Promise<void>;
  onClose(): void;
  onSave?(): Promise<void>;
}

function GoalHarness(props: GoalHarnessProps): React.JSX.Element {
  const [objective, setObjective] = useState(props.goal?.objective ?? "");
  const [tokenBudget, setTokenBudget] = useState("");
  return (
    <ThreadGoalSheetView
      error={null}
      goal={props.goal}
      loading={false}
      objective={objective}
      onClear={props.onClear ?? resolveVoid}
      onClose={props.onClose}
      onObjectiveChange={setObjective}
      onSave={props.onSave ?? resolveVoid}
      onTokenBudgetChange={setTokenBudget}
      tokenBudget={tokenBudget}
    />
  );
}

function goalFixture(): V2ThreadGoal {
  return {
    createdAtMs: 1,
    objective: "Ship V2",
    status: "active",
    threadId: "thread-1",
    timeUsedSeconds: 0,
    tokenBudget: null,
    tokensUsed: 0,
    updatedAtMs: 2,
  };
}

function resolveVoid(): Promise<void> {
  return Promise.resolve();
}

function deferred<T>(): { promise: Promise<T>; reject(cause: unknown): void } {
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((_resolve, fail) => {
    reject = fail;
  });
  return { promise, reject };
}
