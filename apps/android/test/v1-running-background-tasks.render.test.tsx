import { layOutContentMenus } from "./fixtures/contentMenuLayout";
import { QueryClient, QueryClientProvider, queryOptions } from "@tanstack/react-query";
import { act, fireEvent, render } from "@testing-library/react-native";
import type { ReactNode } from "react";

import {
  ConversationRouteNavigationContext,
  type ConversationRouteNavigation,
} from "../src/features/conversation/conversationRouteNavigation";
import { BackgroundTerminalOutputHost } from "../src/features/conversation/turns/BackgroundTerminalOutputHost";
import type { LargeContentRouteRequest } from "../src/services/content/contentRouteSession";
import type { RunningBackgroundTask } from "../src/data/runningBackgroundTasks";
import { TaskNotificationLine } from "../src/features/conversation/turns/TaskNotificationLine";
import { useRunningTaskPlacement } from "../src/features/conversation/timeline/useRunningTaskPlacement";
import {
  BackgroundTaskContext,
  BackgroundTerminalsContext,
  RunningBackgroundTasksContext,
} from "../src/features/conversation/turns/turnContexts";

const running: RunningBackgroundTask = {
  command: "npm test",
  itemId: "toolu_bg",
  kind: "task",
  task: { description: "Run the tests", startedAt: 1_760_000_100, status: "running", taskId: "b1" },
  turnId: "turn-1",
};

const terminal: RunningBackgroundTask = {
  command: "pnpm dev",
  itemId: "call_exec",
  kind: "terminal",
  processId: "1042",
};

function RunningBackgroundTasksPanel() {
  const { footer } = useRunningTaskPlacement([], true);
  return <TaskNotificationLine reports={footer} />;
}

function withTasks(
  tasks: readonly RunningBackgroundTask[],
  children: ReactNode,
  openTerminals:
    | ((terminal: Extract<RunningBackgroundTask, { readonly kind: "terminal" }>) => Promise<void>)
    | null = null,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const query = queryOptions<readonly RunningBackgroundTask[]>({
    queryFn: async () => tasks,
    queryKey: ["thread/backgroundTasks", "server", "thread"],
  });
  return (
    <QueryClientProvider client={client}>
      <RunningBackgroundTasksContext.Provider value={query}>
        <BackgroundTerminalsContext.Provider value={openTerminals}>
          {children}
        </BackgroundTerminalsContext.Provider>
      </RunningBackgroundTasksContext.Provider>
    </QueryClientProvider>
  );
}

it("shows each running background command as its pill below the conversation", async () => {
  const view = render(withTasks([running], <RunningBackgroundTasksPanel />));
  expect(await view.findByText("Run the tests")).toBeOnTheScreen();
});

it("opens a running command's output from its pill", async () => {
  const openTask = jest.fn(async () => undefined);
  const view = render(
    withTasks(
      [running],
      <BackgroundTaskContext.Provider value={openTask}>
        <RunningBackgroundTasksPanel />
      </BackgroundTaskContext.Provider>,
    ),
  );
  const pill = await view.findByTestId("task-notification-line");
  await act(async () => {
    fireEvent.press(pill);
  });
  expect(openTask).toHaveBeenCalledWith({ name: "Run the tests", taskId: "b1" });
});

it("opens a single provider terminal directly through the common output interaction", async () => {
  const openTerminals = jest.fn(async () => undefined);
  const view = render(withTasks([terminal], <RunningBackgroundTasksPanel />, openTerminals));
  const pill = await view.findByLabelText("pnpm dev running");
  await act(async () => {
    fireEvent.press(pill);
  });
  expect(openTerminals).toHaveBeenCalledWith(terminal);
  expect(view.queryByTestId("task-notification-list")).toBeNull();
});

it("opens the listed process and recovers output from the same thread without terminal management actions", async () => {
  const openContent = jest.fn((_request: LargeContentRouteRequest) => undefined);
  const navigation: ConversationRouteNavigation = {
    openAgents: jest.fn(),
    openAttachments: jest.fn(),
    openChanges: jest.fn(),
    openCodeDocument: jest.fn(),
    openContent,
    openDocument: jest.fn(),
    openDrawing: jest.fn(),
    openTaskOutput: jest.fn(),
    openTerminal: jest.fn(),
    openTool: jest.fn(),
    openTurnChanges: jest.fn(),
  };
  const read = jest.fn(async () => null);
  const view = render(
    withTasks(
      [terminal],
      <ConversationRouteNavigationContext.Provider value={navigation}>
        <BackgroundTerminalOutputHost
          connectionId="server"
          threadId="thread"
          getTransferAccess={async () => {
            throw new Error("unused");
          }}
          readTerminalCommand={read}
        >
          <RunningBackgroundTasksPanel />
        </BackgroundTerminalOutputHost>
      </ConversationRouteNavigationContext.Provider>,
    ),
  );
  const pill = await view.findByLabelText("pnpm dev running");
  await act(async () => {
    fireEvent.press(pill);
  });
  const request = openContent.mock.calls[0]?.[0];
  expect(request).toMatchObject({
    kind: "backgroundTerminal",
    itemId: terminal.itemId,
    processId: terminal.processId,
    threadId: "thread",
  });
  if (request?.kind !== "backgroundTerminal") throw new Error("Missing terminal route");
  await expect(request.isRunning()).resolves.toBe(true);
  const signal = new AbortController().signal;
  await request.read(terminal.itemId, signal);
  expect(read).toHaveBeenCalledWith({
    connectionId: "server",
    itemId: terminal.itemId,
    signal,
    threadId: "thread",
  });
});

it("shows a failed open at the footer pill and clears it after a successful retry", async () => {
  const open = jest.fn(async () => undefined).mockRejectedValueOnce(new Error("Connection lost"));
  const view = render(withTasks([terminal], <RunningBackgroundTasksPanel />, open));
  const pill = await view.findByLabelText("pnpm dev running");
  await act(async () => {
    fireEvent.press(pill);
  });
  expect(view.getByText("Connection lost")).toBeOnTheScreen();
  await act(async () => {
    fireEvent.press(pill);
  });
  expect(view.queryByText("Connection lost")).toBeNull();
  expect(open).toHaveBeenCalledTimes(2);
});

it("groups running tasks and terminals into one picker without opening either immediately", async () => {
  const openTerminals = jest.fn(async () => undefined);
  const view = render(
    withTasks([running, terminal], <RunningBackgroundTasksPanel />, openTerminals),
  );
  expect(await view.findByText("2 background tasks")).toBeOnTheScreen();
  expect(view.getAllByTestId("task-notification-line")).toHaveLength(1);
  expect(openTerminals).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.press(view.getByTestId("task-notification-line"));
  });
  layOutContentMenus(view);
  await act(async () => {
    fireEvent.press(view.getByText("pnpm dev"));
  });
  expect(openTerminals).toHaveBeenCalledWith(terminal);
});

it("draws nothing when no background command runs or the thread cannot list them", async () => {
  const empty = render(withTasks([], <RunningBackgroundTasksPanel />));
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  expect(empty.queryByTestId("task-notification-line-row")).toBeNull();
  empty.unmount();
  const unavailable = render(
    <QueryClientProvider client={new QueryClient()}>
      <RunningBackgroundTasksPanel />
    </QueryClientProvider>,
  );
  expect(unavailable.toJSON()).toBeNull();
});
