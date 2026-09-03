import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { DrawingWorkspaceView } from "../src/v2/presentation/drawing/DrawingWorkspaceView";

const SAFE_AREA_METRICS = {
  frame: { height: 800, width: 400, x: 0, y: 0 },
  insets: { bottom: 0, left: 0, right: 0, top: 0 },
};

describe("V2 drawing workspace", () => {
  it("leaves pending state after a rejected commit without closing", async () => {
    const commit = deferred<boolean>();
    const onClose = jest.fn();
    const onCommit = jest.fn(() => commit.promise);
    render(
      <DrawingWorkspaceView
        editing={false}
        initialSnapshot={null}
        mode="drawing"
        onClose={onClose}
        onCommit={onCommit}
      />,
      { wrapper: TestSafeArea },
    );

    fireEvent.press(screen.getByLabelText("Attach drawing"));
    expect(screen.getByLabelText("Attach drawing").props.accessibilityState.busy).toBe(true);
    expect(screen.getByTestId("v2-drawing-commit-shimmer").props.accessibilityLabel).toBe(
      "Attaching drawing",
    );

    await act(async () => {
      commit.resolve(false);
      await commit.promise;
    });

    expect(screen.getByLabelText("Attach drawing").props.accessibilityState.busy).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("reports commit errors and restores the attachment action", async () => {
    const onClose = jest.fn();
    const onCommit = jest.fn(async () => {
      throw new Error("Attachment staging failed");
    });
    render(
      <DrawingWorkspaceView
        editing
        initialSnapshot={null}
        mode="drawing"
        onClose={onClose}
        onCommit={onCommit}
      />,
      { wrapper: TestSafeArea },
    );

    await act(async () => fireEvent.press(screen.getByLabelText("Save drawing")));

    expect(screen.getByText("Attachment staging failed")).toBeTruthy();
    expect(screen.getByLabelText("Save drawing").props.accessibilityState.busy).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });
});

interface TestSafeAreaProps {
  children: ReactNode;
}

function TestSafeArea(props: TestSafeAreaProps): React.JSX.Element {
  return <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>{props.children}</SafeAreaProvider>;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
