import type { RenderBlock } from "@codewide/renderers";
import { act, fireEvent, render, within } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import type { BackgroundTaskOutputPage } from "../src/data/backgroundTaskOutput";
import { BackgroundTaskOutputButton } from "../src/features/conversation/protocol/BackgroundTaskOutputButton";
import {
  ConversationRouteNavigationContext,
  type ConversationRouteNavigation,
} from "../src/features/conversation/conversationRouteNavigation";
import { BackgroundTaskOutputHost } from "../src/features/conversation/turns/BackgroundTaskOutputHost";
import { BackgroundTaskOutputScreen } from "../src/features/conversation/turns/BackgroundTaskOutputScreen";
import { CommandOutputScreen } from "../src/features/conversation/turns/CommandOutputScreen";
import type { TaskOutputRouteRequest } from "../src/services/backgroundTasks/taskOutputRouteSession";
import { colors, radii, spacing } from "../src/theme";
import { AppText } from "../src/ui/AppText";
import { TaskNotificationLine } from "../src/features/conversation/turns/TaskNotificationLine";
import type { TaskNotificationReport } from "../src/rendering/taskNotifications";
import {
  terminalClearSearch,
  terminalFindNext,
  terminalFindPrevious,
} from "./mocks/ExpoLibghostty";

jest.mock("expo-libghostty", () => jest.requireActual("./mocks/ExpoLibghostty"));

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

const COMMAND = "gh pr checks 83 --watch";

function page(text: string, nextOffset: number | null): BackgroundTaskOutputPage {
  return {
    command: COMMAND,
    nextOffset,
    sizeBytes: 12,
    status: "running",
    taskId: "bd3cb8oli",
    text,
  };
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

  // The task's name titles the screen; its command is a prompt line above the output.
  expect(view.getByRole("header")).toHaveTextContent("Wait for CI");
  const command = view.getByTestId("command-output-command");
  expect(command).toHaveStyle({
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.medium,
    marginHorizontal: spacing.md,
    paddingHorizontal: spacing.md,
  });
  expect(within(command).getByText("❯")).toBeOnTheScreen();
  expect(within(command).getByText(COMMAND).props.selectable).toBeUndefined();
  // The command copies on its own, apart from the whole output.
  const copy = jest.spyOn(Clipboard, "setStringAsync");
  fireEvent.press(within(command).getByLabelText("Copy"));
  expect(copy).toHaveBeenLastCalledWith(COMMAND);

  // The next page follows without a button; each part is written once, with
  // the carriage returns a terminal needs.
  expect(read).toHaveBeenLastCalledWith("bd3cb8oli", 11);
  const grid = view.getByTestId("terminal-grid");
  expect(grid).toHaveTextContent("first page\r\nsecond\r\n[exited with code 0]", {
    normalizeWhitespace: false,
  });
  expect(grid).toHaveStyle({
    marginHorizontal: spacing.md,
    marginVertical: spacing.xs,
  });
  expect(grid.props.accessibilityHint).toBe("read-only");
  // The header copies everything like a terminal: the prompt line, then the output.
  const header = within(view.getByTestId("command-output-header"));
  const headerCopy = header.getByLabelText("Copy");
  const headerSearch = header.getByLabelText("Search command output");
  const headerActionStyle = headerSearch.props.style;
  expect(headerCopy.props.style).toEqual(headerSearch.props.style);
  fireEvent.press(headerCopy);
  expect(copy).toHaveBeenLastCalledWith(`❯ ${COMMAND}\nfirst page\nsecond\n[exited with code 0]`);
  // The raw terminal owns the remaining surface; there is no duplicate status footer.
  expect(view.queryByText("Finished")).toBeNull();
  expect(view.queryByText("· exit 0 · 12 B")).toBeNull();
  expect(view.queryByText(/load more|read new output/iu)).toBeNull();

  fireEvent.press(view.getByLabelText("Search command output"));
  fireEvent.changeText(view.getByLabelText("Find in command output"), "second");
  expect(view.getByLabelText("Previous match").props.style).toEqual(headerActionStyle);
  expect(view.getByLabelText("Next match").props.style).toEqual(headerActionStyle);
  expect(view.getByLabelText("Close output search").props.style).toEqual(headerActionStyle);
  fireEvent.press(view.getByLabelText("Next match"));
  fireEvent.press(view.getByLabelText("Previous match"));
  expect(terminalFindNext).toHaveBeenLastCalledWith("second");
  expect(terminalFindPrevious).toHaveBeenLastCalledWith("second");
  fireEvent.press(view.getByLabelText("Close output search"));
  expect(terminalClearSearch).toHaveBeenCalled();

  fireEvent.press(view.getByLabelText("Close command output"));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("shows no prompt line when the Companion does not know the command", async () => {
  const read = jest.fn(async () => ({ ...page("", null), command: null }));
  const view = render(
    <BackgroundTaskOutputScreen
      onClose={jest.fn()}
      opening="opening-2"
      request={{
        first: { ...page("first page\n", 11), command: null },
        name: "Wait for CI",
        read,
        taskId: "bd3cb8oli",
      }}
    />,
  );
  await act(async () => undefined);

  expect(view.getByRole("header")).toHaveTextContent("Wait for CI");
  expect(view.queryByTestId("command-output-command")).toBeNull();
});

it("collapses a long command to three lines and keeps its prompt on the first line", () => {
  const longCommand = "pnpm --filter @codewide/android run a-command-that-wraps-across-four-lines";
  const view = render(
    <CommandOutputScreen
      command={longCommand}
      error={null}
      loading={false}
      onClose={jest.fn()}
      output={{ headOmitted: false, text: "", totalChars: 0 }}
      outputSource="long-command"
      status="finished"
      title="Command"
    />,
  );
  const command = view.getByTestId("command-output-command");
  const commandText = within(command).getByText(longCommand);
  expect(command).toHaveStyle({ alignItems: "flex-start" });
  expect(commandText.props.numberOfLines).toBe(3);

  fireEvent(commandText, "textLayout", { nativeEvent: { lines: [{}, {}, {}, {}] } });
  fireEvent.press(view.getByLabelText("Expand command"));
  expect(within(command).getByText(longCommand).props.numberOfLines).toBeUndefined();

  fireEvent.press(view.getByLabelText("Collapse command"));
  expect(within(command).getByText(longCommand).props.numberOfLines).toBe(3);
});

it("shimmers only the command text while it is running and puts failure on that row", () => {
  const running = render(
    <CommandOutputScreen
      command={COMMAND}
      error={null}
      loading={false}
      onClose={jest.fn()}
      output={{ headOmitted: false, text: "building", totalChars: 8 }}
      outputSource="running"
      status="running"
      title="Command"
    />,
  );
  const runningCommand = running
    .UNSAFE_getAllByType(AppText)
    .find((node) => node.props.children === COMMAND);
  expect(runningCommand?.props.shimmering).toBe(true);
  expect(running.queryByTestId("command-output-error")).toBeNull();
  running.unmount();

  const failed = render(
    <CommandOutputScreen
      command={COMMAND}
      error="Output reader failed"
      loading={false}
      onClose={jest.fn()}
      output={{ headOmitted: false, text: "failed", totalChars: 6 }}
      outputSource="failed"
      status="failed"
      title="Command"
    />,
  );
  const failedCommand = failed
    .UNSAFE_getAllByType(AppText)
    .find((node) => node.props.children === COMMAND);
  expect(failedCommand?.props.shimmering).toBe(false);
  expect(failed.getByLabelText("Output reader failed")).toBeOnTheScreen();
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
        <BackgroundTaskOutputButton block={block} />
      </BackgroundTaskOutputHost>
    </ConversationRouteNavigationContext.Provider>,
  );

  await act(async () => {
    fireEvent.press(view.getByTestId("background-task-output-open"));
  });
  expect(read).toHaveBeenCalledWith("bd3cb8oli", 0);
  expect(opened[0]).toMatchObject({ name: "Background command", taskId: "bd3cb8oli" });
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
        <BackgroundTaskOutputButton block={block} />
      </BackgroundTaskOutputHost>
    </ConversationRouteNavigationContext.Provider>,
  );

  expect(view.queryByTestId("background-task-output-open")).toBeNull();
});
