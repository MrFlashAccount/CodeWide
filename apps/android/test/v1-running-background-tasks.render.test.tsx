import { QueryClient, QueryClientProvider, queryOptions } from "@tanstack/react-query";
import { act, fireEvent, render } from "@testing-library/react-native";
import type { ReactNode } from "react";

import type { RunningBackgroundTask } from "../src/data/runningBackgroundTasks";
import { RunningBackgroundTasksPanel } from "../src/features/conversation/turns/RunningBackgroundTasksPanel";
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

function withTasks(
  tasks: readonly RunningBackgroundTask[],
  children: ReactNode,
  openTerminals: (() => void) | null = null,
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

it("shows the provider's open terminals as one pill that opens the terminals sheet", async () => {
  const openTerminals = jest.fn();
  const view = render(
    withTasks([running, terminal], <RunningBackgroundTasksPanel />, openTerminals),
  );
  expect(await view.findByText("Run the tests")).toBeOnTheScreen();
  fireEvent.press(view.getByLabelText("pnpm dev running"));
  expect(openTerminals).toHaveBeenCalledTimes(1);
});

it("draws nothing when no background command runs or the thread cannot list them", async () => {
  const empty = render(withTasks([], <RunningBackgroundTasksPanel />));
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  expect(empty.queryByTestId("task-notification-line-row")).toBeNull();
  empty.unmount();
  const unavailable = render(<RunningBackgroundTasksPanel />);
  expect(unavailable.toJSON()).toBeNull();
});
