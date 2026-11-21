import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { ConversationRouteFullscreenOverlay } from "../src/features/conversation/ConversationRouteFullscreenOverlay";
import {
  ConversationRouteNavigationContext,
  type ConversationRouteNavigation,
} from "../src/features/conversation/conversationRouteNavigation";
import {
  AppFullscreenOverlayHost,
  AppFullscreenOverlayProvider,
} from "../src/ui/AppFullscreenOverlay";
import { terminalOutputEvents } from "../src/data/terminalOutputEvents";
import { BackgroundTerminalOutputScreen } from "../src/features/conversation/turns/BackgroundTerminalOutputScreen";
import type { TerminalOutputRequest } from "../src/services/content/terminalOutputRequest";

jest.mock("expo-libghostty", () => jest.requireActual("./mocks/ExpoLibghostty"));
// WHY: Node has no Android window; the real overlay owner still mounts its detached content.
jest.mock("../src/ui/AppFullscreenModal", () => ({
  AppFullscreenModal: ({
    children,
    isOpen,
  }: {
    readonly children: ReactNode;
    readonly isOpen: boolean;
  }) => (isOpen ? children : null),
}));

const navigation: ConversationRouteNavigation = {
  openAgents: jest.fn(),
  openAttachments: jest.fn(),
  openChanges: jest.fn(),
  openCodeDocument: jest.fn(),
  openContent: jest.fn(),
  openDocument: jest.fn(),
  openDrawing: jest.fn(),
  openTaskOutput: jest.fn(),
  openTerminal: jest.fn(),
  openTool: jest.fn(),
  openTurnChanges: jest.fn(),
};

const process = {
  command: "watch checks",
  cpuPercent: null,
  cwd: "/",
  itemId: "item",
  osPid: null,
  processId: "process",
  rssKb: null,
};
function setup() {
  const client = new QueryClient();
  const isRunning = jest.fn(async () => true);
  const request: TerminalOutputRequest = {
    command: process.command,
    connectionId: "connection",
    getTransferAccess: async () => {
      throw new Error("unused");
    },
    itemId: process.itemId,
    kind: "backgroundTerminal",
    isRunning,
    processId: process.processId,
    read: async () => null,
    threadId: "thread",
  };
  const onDismiss = jest.fn();
  const view = render(
    <AppFullscreenOverlayProvider>
      <QueryClientProvider client={client}>
        <ConversationRouteNavigationContext.Provider value={navigation}>
          <ConversationRouteFullscreenOverlay
            onDismiss={onDismiss}
            render={(close) => <BackgroundTerminalOutputScreen onClose={close} request={request} />}
            scope="terminal-output-test"
          />
        </ConversationRouteNavigationContext.Provider>
      </QueryClientProvider>
      <AppFullscreenOverlayHost />
    </AppFullscreenOverlayProvider>,
  );
  return { client, isRunning, onDismiss, view };
}

it("writes received output into Ghostty and replaces it with complete output without duplicating the tail", async () => {
  const { client, isRunning, view } = setup();
  await waitFor(() => {
    expect(isRunning).toHaveBeenCalled();
  });
  expect(view.getByTestId("terminal-grid")).toHaveTextContent(/Earlier output is not shown\./);
  expect(view.queryByText(/Output received since opening/)).toBeNull();
  expect(view.getByText("Running")).toBeOnTheScreen();
  expect(view.queryByText("Stop process")).toBeNull();
  await act(async () => {
    terminalOutputEvents.publish("connection", "item/commandExecution/outputDelta", {
      delta: "tail\n",
      itemId: "item",
      threadId: "thread",
    });
  });
  await waitFor(() => {
    expect(view.getByTestId("terminal-grid")).toHaveTextContent(/tail/);
  });
  expect(
    String(view.getByTestId("terminal-grid").props.children).match(
      /Earlier output is not shown\./g,
    ),
  ).toHaveLength(1);
  await act(async () => {
    terminalOutputEvents.publish("connection", "item/completed", {
      item: {
        id: "item",
        type: "commandExecution",
        command: "watch checks",
        status: "completed",
        exitCode: 0,
        aggregatedOutput: "beginning\ntail\n",
      },
      threadId: "thread",
    });
  });
  await waitFor(() => {
    expect(view.getByTestId("terminal-grid")).toHaveTextContent(/beginning\s+tail/);
  });
  expect(
    String(view.getByTestId("terminal-grid").props.children).trim().split(/\r?\n/),
  ).toStrictEqual(["beginning", "tail"]);
  expect(view.queryByText(/Output received since opening/)).toBeNull();
  expect(view.queryByText("Stop process")).toBeNull();
  view.unmount();
  client.clear();
});

it("uses the workspace query client across fullscreen presentation and cancels on close", async () => {
  const { client, isRunning, onDismiss, view } = setup();
  await waitFor(() => {
    expect(isRunning).toHaveBeenCalled();
  });
  const queries = client.getQueryCache().findAll({ queryKey: ["background-terminal-output"] });
  expect(queries).toHaveLength(1);
  expect(queries[0]?.state.fetchStatus).toBe("fetching");
  await act(async () => {
    fireEvent.press(view.getByLabelText("Close command output"));
  });
  expect(onDismiss).toHaveBeenCalledTimes(1);
  expect(view.queryByTestId("command-output-screen")).toBeNull();
  expect(queries[0]?.state.fetchStatus).toBe("idle");
  view.unmount();
  client.clear();
});
