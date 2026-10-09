import { act, fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { type ReactNode } from "react";
import { Pressable, StyleSheet } from "react-native";
import type { ThreadGoal } from "@codewide/codex-protocol/v0.155.1/v2";

// WHY: The native resource database needs a cache root, even for in-memory goal rows.
jest.mock("expo-file-system/legacy", () => ({
  cacheDirectory: "/cache/",
  getInfoAsync: async () => ({ exists: false }),
}));

import { useThreadGoalRow } from "../src/data/use-workspace-resource-row";
import { createWorkspaceResourceDatabase } from "../src/data/workspace-resource-database";
import { threadResourceKey } from "../src/data/workspace-resource-keys";
import { useComposerFeatureActions } from "../src/features/composer/composerFeatureActions";
import { ThreadGoalMenu } from "../src/features/goal/ThreadGoalMenu";
import type { ComposerToolRouteRequest } from "../src/services/composer/composerToolRouteSession";
import { colors, typeScale } from "../src/theme";
import { AppText } from "../src/ui/AppText";

type GoalRequest = Extract<ComposerToolRouteRequest, { readonly kind: "goal" }>;

// WHY: Exercise the actual Android anchored shell with only the unavailable Expo view registry replaced.
jest.mock("@expo/ui/jetpack-compose", () => {
  const NativeView = require("react-native").View;
  const React = require("react");
  const Menu = (props: { children: ReactNode; expanded: boolean; onDismissRequest(): void }) =>
    React.createElement(NativeView, { ...props, testID: "compose-goal-menu" }, props.children);
  Menu.Trigger = NativeView;
  Menu.Items = NativeView;
  return { Host: NativeView, RNHostView: NativeView, DropdownMenu: Menu };
});
jest.mock("@expo/ui/jetpack-compose/modifiers", () => ({
  width: (value: number) => ({ width: value }),
}));

function GoalControls({
  onCreate,
  interrupt,
  request,
  onEdit = () => undefined,
}: {
  readonly onCreate: () => void;
  readonly interrupt: (turnId: string) => Promise<void>;
  readonly request: GoalRequest;
  readonly onEdit?: () => void;
}): React.JSX.Element {
  const resource = useThreadGoalRow(request.resources, request.goalResourceId);
  const actions = useComposerFeatureActions(
    async () => undefined,
    () => undefined,
    () => undefined,
    () => undefined,
    onCreate,
    () => undefined,
    onEdit,
  );
  return (
    <>
      <Pressable
        accessibilityLabel="Attach new goal"
        onPress={() => actions.openComposerFeature("goal")}
      />
      {resource?.goal !== null && resource?.goal !== undefined && (
        <ThreadGoalMenu
          captureGoalLifecycle={() => {
            const clear = request.clearGoal;
            const setStatus = request.setGoalStatus;
            if (clear === undefined || setStatus === undefined)
              throw new Error("Missing test goal commands");
            return { clear, setStatus };
          }}
          currentTurnId="turn"
          goal={resource.goal}
          onBeforeOpen={() => undefined}
          onEdit={actions.openGoalDetails}
          onInterrupt={interrupt}
        />
      )}
    </>
  );
}

function controlsFixture() {
  const resources = createWorkspaceResourceDatabase();
  const goalResourceId = threadResourceKey("connection", "thread");
  let current: ThreadGoal = {
    createdAt: 1,
    objective: "Keep the release healthy",
    status: "active",
    threadId: "thread",
    timeUsedSeconds: 90,
    tokenBudget: 20_000,
    tokensUsed: 1_000,
    updatedAt: 2,
  };
  const publish = (goal: ThreadGoal | null) => {
    resources.putThreadGoal({
      connectionId: "connection",
      error: null,
      goal,
      id: goalResourceId,
      status: "ready",
      threadId: "thread",
    });
  };
  publish(current);
  const request: GoalRequest = {
    clearGoal: jest.fn(async () => {
      publish(null);
      return true;
    }),
    goalResourceId,
    kind: "goal",
    resources,
    setGoal: jest.fn(async (input) => {
      current = { ...current, ...input, updatedAt: current.updatedAt + 1 };
      publish(current);
      return current;
    }),
    setGoalStatus: jest.fn(async (status) => {
      current = { ...current, status, updatedAt: current.updatedAt + 1 };
      publish(current);
      return current;
    }),
    voiceScope: "test",
  };
  const interrupt = jest.fn(async (_turnId: string) => undefined);
  return { goalResourceId, interrupt, request, resources };
}

it("reads a long objective without putting status or lifecycle actions inside the scrolling text", async () => {
  const { interrupt, request } = controlsFixture();
  const objective = "Keep the release healthy, verify checks and report the final result. ".repeat(
    40,
  );
  await act(async () => {
    await request.setGoal?.({ objective, tokenBudget: null });
  });
  const screen = render(
    <GoalControls interrupt={interrupt} onCreate={jest.fn()} request={request} />,
  );
  await act(async () => fireEvent.press(screen.getByTestId("thread-goal-chip")));
  expect(screen.getByTestId("goal-menu-objective").props.numberOfLines).toBeUndefined();
  const reader = screen.getByTestId("goal-objective-reader");
  await act(async () => fireEvent(reader, "contentSizeChange", 328, 2400));
  expect(screen.getByTestId("goal-objective-reader").props.style.height).toBeLessThanOrEqual(200);
  expect(within(reader).getByText(objective)).toBeVisible();
  expect(within(reader).queryByText("Time used")).toBeNull();
  for (const name of ["Pause goal", "Edit goal", "Stop goal"]) {
    expect(within(reader).queryByRole("button", { name })).toBeNull();
    expect(
      within(screen.getByTestId("goal-menu-actions")).getByRole("button", { name }),
    ).toBeVisible();
  }
  for (const label of ["Pause", "Resume", "Edit", "Stop"]) {
    expect(screen.queryByText(label)).toBeNull();
  }
  expect(screen.queryByRole("button", { name: "Close goal details" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Collapse" })).toBeNull();
  await act(async () => fireEvent.press(screen.getByTestId("thread-goal-chip")));
  expect(screen.queryByTestId("thread-goal-menu")).toBeNull();
});

it("sizes a short objective to its content instead of reserving the maximum reader height", async () => {
  const { interrupt, request } = controlsFixture();
  const screen = render(
    <GoalControls interrupt={interrupt} onCreate={jest.fn()} request={request} />,
  );
  await act(async () => fireEvent.press(screen.getByTestId("thread-goal-chip")));
  await act(async () =>
    fireEvent(screen.getByTestId("goal-objective-reader"), "contentSizeChange", 328, 40),
  );
  expect(screen.getByTestId("goal-objective-reader").props.style.height).toBe(40);
  expect(screen.queryByText("Collapse")).toBeNull();
});

it("presents the objective as non-interactive reading text and Goal as a toolbar title", async () => {
  const { interrupt, request } = controlsFixture();
  const screen = render(
    <GoalControls interrupt={interrupt} onCreate={jest.fn()} request={request} />,
  );
  await act(async () => fireEvent.press(screen.getByTestId("thread-goal-chip")));
  const objective = screen.getByTestId("goal-menu-objective");
  expect(objective.props.selectable).toBe(false);
  expect(objective.props.onPress).toBeUndefined();
  expect(objective).toHaveTextContent("Keep the release healthy");
  const menu = within(screen.getByTestId("thread-goal-menu"));
  const heading = menu.getByRole("header", { name: "Goal" });
  expect(StyleSheet.flatten(heading.props.style)).toMatchObject({
    color: colors.text,
    fontSize: typeScale.title.fontSize,
    lineHeight: typeScale.title.lineHeight,
  });
  expect(menu.getByRole("button", { name: "Edit goal" })).toBeEnabled();
});

it("preserves icon-only accessible controls and stable status while an operation is pending", async () => {
  const { interrupt, request } = controlsFixture();
  let rejectPause: (error: Error) => void = () => {
    throw new Error("Pending pause not captured");
  };
  const pendingRequest: GoalRequest = {
    ...request,
    setGoalStatus: () =>
      new Promise<ThreadGoal>((_resolve, reject) => {
        rejectPause = reject;
      }),
  };
  const screen = render(
    <GoalControls interrupt={interrupt} onCreate={jest.fn()} request={pendingRequest} />,
  );
  fireEvent.press(screen.getByTestId("thread-goal-chip"));
  fireEvent.press(screen.getByRole("button", { name: "Pause goal" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Pause goal" }).props.accessibilityState,
    ).toMatchObject({ busy: true, disabled: true }),
  );
  for (const name of ["Edit goal", "Stop goal"]) {
    expect(screen.getByRole("button", { name })).toBeDisabled();
  }
  const statusText = screen.getByTestId("goal-menu-status");
  expect(statusText).toHaveTextContent("Active");
  expect(
    screen.UNSAFE_getAllByType(AppText).find((node) => node.props.testID === "goal-menu-status")
      ?.props.shimmering,
  ).toBe(true);
  expect(screen.queryByText("Pausing…")).toBeNull();
  expect(screen.queryByText("Pause")).toBeNull();
  await act(async () => rejectPause(new Error("Pause rejected")));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Pause rejected"));
  expect(screen.getByRole("button", { name: "Pause goal" })).toBeEnabled();
  expect(screen.getByTestId("goal-menu-status")).toBe(statusText);
  expect(
    screen.UNSAFE_getAllByType(AppText).find((node) => node.props.testID === "goal-menu-status")
      ?.props.shimmering,
  ).toBe(false);
});

it("opens existing goal controls from its chip and preserves creation as a separate composer action", async () => {
  const { interrupt, request, resources } = controlsFixture();
  const create = jest.fn();
  const edit = jest.fn();
  const screen = render(
    <GoalControls interrupt={interrupt} onCreate={create} onEdit={edit} request={request} />,
  );

  fireEvent.press(screen.getByLabelText("Attach new goal"));
  expect(create).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("Edit goal")).toBeNull();
  create.mockClear();

  fireEvent.press(screen.getByTestId("thread-goal-chip"));
  expect(screen.getByTestId("thread-goal-menu")).toBeVisible();
  expect(screen.getByTestId("goal-menu-objective")).toHaveTextContent("Keep the release healthy");
  expect(screen.queryByText("Status")).toBeNull();
  expect(screen.queryByText("Time used")).toBeNull();
  expect(screen.getByText("1m 30s")).toBeVisible();
  expect(screen.queryByText("Edit goal")).toBeNull();
  await act(async () => fireEvent.press(screen.getByRole("button", { name: "Pause goal" })));
  await waitFor(() => expect(interrupt).toHaveBeenCalledWith("turn"));
  expect(screen.queryByRole("alert")).toBeNull();
  await waitFor(() => expect(screen.queryByTestId("thread-goal-menu")).toBeNull());
  expect(request.setGoalStatus).toHaveBeenCalledWith("paused");
  expect(request.setGoal).not.toHaveBeenCalled();
  expect(screen.getByText("Paused")).toBeVisible();
  expect(interrupt).toHaveBeenCalledWith("turn");

  fireEvent.press(screen.getByTestId("thread-goal-chip"));
  await act(async () => fireEvent.press(screen.getByRole("button", { name: "Resume goal" })));
  await waitFor(() => expect(request.setGoalStatus).toHaveBeenLastCalledWith("active"));
  await waitFor(() => expect(screen.queryByTestId("thread-goal-menu")).toBeNull());
  expect(request.setGoalStatus).toHaveBeenLastCalledWith("active");
  expect(screen.getByText("Active")).toBeVisible();

  fireEvent.press(screen.getByTestId("thread-goal-chip"));
  fireEvent.press(screen.getByRole("button", { name: "Edit goal" }));
  expect(screen.queryByTestId("thread-goal-menu")).toBeNull();
  expect(edit).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText("Goal objective")).toBeNull();
  expect(request.setGoal).not.toHaveBeenCalled();

  fireEvent.press(screen.getByTestId("thread-goal-chip"));
  await act(async () => fireEvent.press(screen.getByRole("button", { name: "Stop goal" })));
  await waitFor(() => expect(screen.queryByTestId("thread-goal-chip")).toBeNull());
  expect(request.clearGoal).toHaveBeenCalledTimes(1);
  expect(interrupt).toHaveBeenCalledTimes(2);
  expect(create).not.toHaveBeenCalled();
  screen.unmount();
  await resources.deleteConnection("connection");
});

it("keeps the editor and goal intact when a lifecycle command fails", async () => {
  const { goalResourceId, interrupt, request, resources } = controlsFixture();
  const failedRequest: GoalRequest = {
    ...request,
    setGoalStatus: jest.fn(async () => {
      throw new Error("Could not pause goal");
    }),
  };
  const screen = render(
    <GoalControls interrupt={interrupt} onCreate={jest.fn()} request={failedRequest} />,
  );

  fireEvent.press(screen.getByTestId("thread-goal-chip"));
  fireEvent.press(screen.getByRole("button", { name: "Pause goal" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not pause goal"));
  expect(screen.getByTestId("thread-goal-menu")).toBeVisible();
  expect(interrupt).not.toHaveBeenCalled();
  expect(resources.threadGoals.get(goalResourceId)?.goal?.status).toBe("active");
  screen.unmount();
  await resources.deleteConnection("connection");
});

it("keeps a paused goal and shows the real error when Stop cannot interrupt its response", async () => {
  const { goalResourceId, request, resources } = controlsFixture();
  const interrupt = jest.fn(async () => {
    throw new Error("Response interruption rejected");
  });
  const screen = render(
    <GoalControls interrupt={interrupt} onCreate={jest.fn()} request={request} />,
  );
  fireEvent.press(screen.getByTestId("thread-goal-chip"));
  fireEvent.press(screen.getByRole("button", { name: "Stop goal" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("Response interruption rejected"),
  );
  expect(request.clearGoal).not.toHaveBeenCalled();
  expect(resources.threadGoals.get(goalResourceId)?.goal?.status).toBe("paused");
  expect(screen.getByTestId("thread-goal-menu")).toBeVisible();
  screen.unmount();
  await resources.deleteConnection("connection");
});

it("keeps Stop available for retry when clearing the paused goal fails", async () => {
  const { goalResourceId, interrupt, request, resources } = controlsFixture();
  const failedRequest: GoalRequest = {
    ...request,
    clearGoal: jest.fn(async () => {
      throw new Error("Goal removal rejected");
    }),
  };
  const screen = render(
    <GoalControls interrupt={interrupt} onCreate={jest.fn()} request={failedRequest} />,
  );
  fireEvent.press(screen.getByTestId("thread-goal-chip"));
  fireEvent.press(screen.getByRole("button", { name: "Stop goal" }));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Goal removal rejected"));
  expect(interrupt).toHaveBeenCalledWith("turn");
  expect(resources.threadGoals.get(goalResourceId)?.goal?.status).toBe("paused");
  expect(screen.getByRole("button", { name: "Stop goal" })).toBeEnabled();
  screen.unmount();
  await resources.deleteConnection("connection");
});
