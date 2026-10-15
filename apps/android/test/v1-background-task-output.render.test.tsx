import type { RenderBlock } from "@codewide/renderers";
import { act, fireEvent, render } from "@testing-library/react-native";
import type { BackgroundTaskOutputPage } from "../src/data/backgroundTaskOutput";
import { BackgroundTaskOutputButton } from "../src/features/conversation/protocol/BackgroundTaskOutputButton";
import {
  ConversationRouteNavigationContext,
  type ConversationRouteNavigation,
} from "../src/features/conversation/conversationRouteNavigation";
import { BackgroundTaskOutputHost } from "../src/features/conversation/turns/BackgroundTaskOutputHost";
import { BackgroundTaskOutputScreen } from "../src/features/conversation/turns/BackgroundTaskOutputScreen";
import type { TaskOutputRouteRequest } from "../src/services/backgroundTasks/taskOutputRouteSession";
import { TaskNotificationLine } from "../src/features/conversation/turns/TaskNotificationLine";
import type { TaskNotificationReport } from "../src/rendering/taskNotifications";

// The Ghostty view is native: this double keeps what the screen writes into it.
jest.mock("expo-libghostty", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { Text } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    TerminalView: function TerminalView(props: {
      readonly readOnly?: boolean;
      readonly ref?: React.Ref<unknown>;
    }) {
      const [written, setWritten] = React.useState("");
      React.useImperativeHandle(props.ref, () => ({
        finish: async () => undefined,
        write: async () => undefined,
        writeText: async (text: string) => {
          setWritten((current) => current + text);
        },
      }));
      return (
        <Text testID="terminal-grid" accessibilityHint={props.readOnly === true ? "read-only" : ""}>
          {written}
        </Text>
      );
    },
  };
});

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

/** The thread route's navigation, recording the task output screens it opens. */
function navigationRecorder() {
  const opened: TaskOutputRouteRequest[] = [];
  const ignore = (): void => undefined;
  const navigation: ConversationRouteNavigation = {
    openAgents: ignore,
    openAttachments: ignore,
    openChanges: ignore,
    openCodeDocument: ignore,
    openContent: ignore,
    openDocument: ignore,
    openDrawing: ignore,
    openTaskOutput: (request) => {
      opened.push(request);
    },
    openTerminal: ignore,
    openTool: ignore,
    openTurnChanges: ignore,
  };
  return { navigation, opened };
}

it("opens a single report's output from its pill, without a list", async () => {
  const read = jest.fn(async () => page("first page\n", 11));
  const { navigation, opened } = navigationRecorder();
  const view = render(
    <ConversationRouteNavigationContext.Provider value={navigation}>
      <BackgroundTaskOutputHost read={read}>
        <TaskNotificationLine reports={[report]} />
      </BackgroundTaskOutputHost>
    </ConversationRouteNavigationContext.Provider>,
  );

  // The line sizes its anchored pill from its laid-out container.
  fireEvent(view.getByTestId("task-notification-line-row"), "layout", {
    nativeEvent: { layout: { height: 40, width: 400, x: 0, y: 0 } },
  });
  await act(async () => {
    fireEvent.press(view.getByTestId("task-notification-line"));
  });

  expect(view.queryByTestId("task-notification-list")).toBeNull();
  expect(read).toHaveBeenCalledWith("bd3cb8oli", 0);
  expect(opened).toHaveLength(1);
  expect(opened[0]).toMatchObject({ name: "Wait for CI", taskId: "bd3cb8oli" });
  expect(opened[0]?.first.text).toBe("first page\n");
});

it("shows why a single report's output could not open under its pill", async () => {
  const read = jest.fn(async () => {
    throw new Error("Task output is no longer available");
  });
  const { navigation, opened } = navigationRecorder();
  const view = render(
    <ConversationRouteNavigationContext.Provider value={navigation}>
      <BackgroundTaskOutputHost read={read}>
        <TaskNotificationLine reports={[report]} />
      </BackgroundTaskOutputHost>
    </ConversationRouteNavigationContext.Provider>,
  );
  fireEvent(view.getByTestId("task-notification-line-row"), "layout", {
    nativeEvent: { layout: { height: 40, width: 400, x: 0, y: 0 } },
  });
  await act(async () => {
    fireEvent.press(view.getByTestId("task-notification-line"));
  });

  expect(opened).toHaveLength(0);
  expect(view.getByTestId("task-notification-error")).toHaveTextContent(
    "Task output is no longer available",
  );
});

it("shows the output in a read-only terminal, reads the rest by itself and closes", async () => {
  const read = jest.fn(async () => ({
    ...page("second\n[exited with code 0]", null),
    status: "completed" as const,
  }));
  const onClose = jest.fn();
  const view = render(
    <BackgroundTaskOutputScreen
      onClose={onClose}
      opening="opening-1"
      request={{ first: page("first page\n", 11), name: "Wait for CI", read, taskId: "bd3cb8oli" }}
    />,
  );
  await act(async () => undefined);

  // The title stays short; the command is pinned above its output.
  expect(view.getByRole("header")).toHaveTextContent("Background command");
  expect(view.getByTestId("background-task-command")).toHaveTextContent("$Wait for CI");

  // The next page follows without a button; each part is written once, with
  // the carriage returns a terminal needs.
  expect(read).toHaveBeenLastCalledWith("bd3cb8oli", 11);
  const grid = view.getByTestId("terminal-grid");
  expect(grid).toHaveTextContent("first page\r\nsecond\r\n[exited with code 0]", {
    normalizeWhitespace: false,
  });
  expect(grid.props.accessibilityHint).toBe("read-only");
  // The footer reads the result; nothing asks to load more.
  expect(view.getByText("Finished")).toBeOnTheScreen();
  expect(view.getByText("· exit 0 · 12 B")).toBeOnTheScreen();
  expect(view.queryByText(/load more|read new output/iu)).toBeNull();

  fireEvent.press(view.getByLabelText("Close task output"));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("opens a background Bash call's output from its command block", async () => {
  const read = jest.fn(async () => page("building…", null));
  const { navigation, opened } = navigationRecorder();
  // WHY: the button reads only `raw` of the generated render block union.
  const block = {
    raw: { codewideBackgroundTaskId: "bd3cb8oli", type: "commandExecution" },
  } as unknown as RenderBlock;
  const view = render(
    <ConversationRouteNavigationContext.Provider value={navigation}>
      <BackgroundTaskOutputHost read={read}>
        <BackgroundTaskOutputButton block={block} name="pnpm build" />
      </BackgroundTaskOutputHost>
    </ConversationRouteNavigationContext.Provider>,
  );

  await act(async () => {
    fireEvent.press(view.getByTestId("background-task-output-open"));
  });
  expect(read).toHaveBeenCalledWith("bd3cb8oli", 0);
  expect(opened[0]).toMatchObject({ name: "pnpm build", taskId: "bd3cb8oli" });
});

it("offers nothing to open where the thread cannot read task output", () => {
  const { navigation } = navigationRecorder();
  // WHY: the button reads only `raw` of the generated render block union.
  const block = {
    raw: { codewideBackgroundTaskId: "bd3cb8oli", type: "commandExecution" },
  } as unknown as RenderBlock;
  const view = render(
    <ConversationRouteNavigationContext.Provider value={navigation}>
      <BackgroundTaskOutputHost read={undefined}>
        <BackgroundTaskOutputButton block={block} name="pnpm build" />
      </BackgroundTaskOutputHost>
    </ConversationRouteNavigationContext.Provider>,
  );

  expect(view.queryByTestId("background-task-output-open")).toBeNull();
});
