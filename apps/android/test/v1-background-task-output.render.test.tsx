import type { RenderBlock } from "@codewide/renderers";
import { act, fireEvent, render } from "@testing-library/react-native";
import type { BackgroundTaskOutputPage } from "../src/data/backgroundTaskOutput";
import { BackgroundTaskOutputButton } from "../src/features/conversation/protocol/BackgroundTaskOutputButton";
import { BackgroundTaskOutputHost } from "../src/features/conversation/turns/BackgroundTaskOutputHost";
import { TaskNotificationLine } from "../src/features/conversation/turns/TaskNotificationLine";
import type { TaskNotificationReport } from "../src/rendering/taskNotifications";

const report: TaskNotificationReport = {
  agentThreadId: null,
  delivery: "wake",
  durationMs: 1_000,
  id: "report-1",
  kind: "command",
  name: "Wait for CI",
  result: null,
  status: "completed",
  taskId: "bd3cb8oli",
  toolUses: null,
};

function page(text: string, nextOffset: number | null): BackgroundTaskOutputPage {
  return { nextOffset, sizeBytes: 12, status: "running", taskId: "bd3cb8oli", text };
}

it("loads a background command's output on press and shows it in a dialog", async () => {
  const read = jest.fn(async (_taskId: string, offset: number) =>
    offset === 0 ? page("first page\n", 11) : page("second", null),
  );
  const view = render(
    <BackgroundTaskOutputHost read={read}>
      <TaskNotificationLine reports={[report]} />
    </BackgroundTaskOutputHost>,
  );

  // The line sizes its anchored pill from its laid-out container.
  fireEvent(view.getByTestId("task-notification-line-row"), "layout", {
    nativeEvent: { layout: { height: 40, width: 400, x: 0, y: 0 } },
  });
  fireEvent.press(view.getByTestId("task-notification-line"));
  await act(async () => {
    fireEvent.press(view.getByTestId("task-notification-row"));
  });

  expect(read).toHaveBeenCalledWith("bd3cb8oli", 0);
  expect(view.getByTestId("background-task-output")).toBeOnTheScreen();
  expect(view.getByText("first page\n")).toBeOnTheScreen();
  expect(view.getByText("Running")).toBeOnTheScreen();

  // The native sheet host takes touches on a device (`pointerEvents="none"` in
  // the RN tree), so the test calls the action's handler directly.
  const more = view.UNSAFE_getByProps({ testID: "background-task-output-more" });
  await act(async () => {
    more.props.onPress();
  });
  expect(read).toHaveBeenLastCalledWith("bd3cb8oli", 11);
  expect(view.getByText("first page\nsecond")).toBeOnTheScreen();
});

it("opens a background Bash call's output from its command block", async () => {
  const read = jest.fn(async () => page("building…", null));
  // WHY: the button reads only `raw` of the generated render block union.
  const block = {
    raw: { codewideBackgroundTaskId: "bd3cb8oli", type: "commandExecution" },
  } as unknown as RenderBlock;
  const view = render(
    <BackgroundTaskOutputHost read={read}>
      <BackgroundTaskOutputButton block={block} name="pnpm build" />
    </BackgroundTaskOutputHost>,
  );

  await act(async () => {
    fireEvent.press(view.getByTestId("background-task-output-open"));
  });
  expect(read).toHaveBeenCalledWith("bd3cb8oli", 0);
  expect(view.getByText("building…")).toBeOnTheScreen();
});

it("offers nothing to open where the thread cannot read task output", () => {
  // WHY: the button reads only `raw` of the generated render block union.
  const block = {
    raw: { codewideBackgroundTaskId: "bd3cb8oli", type: "commandExecution" },
  } as unknown as RenderBlock;
  const view = render(
    <BackgroundTaskOutputHost read={undefined}>
      <BackgroundTaskOutputButton block={block} name="pnpm build" />
    </BackgroundTaskOutputHost>,
  );

  expect(view.queryByTestId("background-task-output-open")).toBeNull();
});
