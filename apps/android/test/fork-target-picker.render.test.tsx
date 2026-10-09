import { fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { View } from "react-native";
import { parseAgentProviderId } from "../src/data/threadAgent";
import { ThreadHeaderMenu } from "../src/features/turnActions/ThreadActions";
import type { ForkTargetChoice } from "../src/features/turnActions/forkTargets";
import { AppNoticeContext } from "../src/ui/appNoticeContext";

// WHY: the native sheet window cannot mount in the Node renderer; the picker's rows are the contract here.
jest.mock("../src/ui/AppSheet", () => {
  const { View: MockView } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    AppSheet: ({ children }: { readonly children: ReactNode }) => <MockView>{children}</MockView>,
    AppSheetScrollView: ({ children, testID }: { readonly children: ReactNode; readonly testID?: string }) => (
      <MockView testID={testID}>{children}</MockView>
    ),
  };
});

const codex = parseAgentProviderId("codex");
if (codex === null) throw new Error("invalid provider fixture");

const choices: readonly ForkTargetChoice[] = [
  { id: "same-agent", subtitle: "Claude with the current settings", target: null, title: "Same agent" },
  { id: "codex:gpt-5.5", subtitle: "Codex", target: { model: "gpt-5.5", provider: codex }, title: "GPT-5.5" },
];

function Wrapper(props: { readonly children: ReactNode }) {
  return (
    // WHY: the header reads the notice controller only for copy feedback, which this test does not use.
    <AppNoticeContext.Provider value={{ show: jest.fn() } as never}>
      <View>{props.children}</View>
    </AppNoticeContext.Provider>
  );
}

function openFork(screen: ReturnType<typeof render>) {
  fireEvent.press(screen.getAllByLabelText("Thread menu")[0]!);
  fireEvent.press(screen.getByLabelText("Thread menu: Fork thread"));
}

it("forks at once with the same agent when there is no picker", async () => {
  const fork = jest.fn(async () => undefined);
  const screen = render(
    <ThreadHeaderMenu archived={false} onFork={fork} onRenameRequest={jest.fn()} pinned={false} threadId="t1" forkTargets={() => null} />,
    { wrapper: Wrapper },
  );
  openFork(screen);
  await waitFor(() => expect(fork).toHaveBeenCalledWith({ boundary: { kind: "all" }, ephemeral: false, target: null }));
  expect(screen.queryByTestId("fork-target-sheet")).toBeNull();
});

it("asks for the target agent and forks into the chosen one", async () => {
  const fork = jest.fn(async () => undefined);
  const screen = render(
    <ThreadHeaderMenu archived={false} onFork={fork} onRenameRequest={jest.fn()} pinned={false} threadId="t1" forkTargets={() => choices} />,
    { wrapper: Wrapper },
  );
  openFork(screen);
  expect(fork).not.toHaveBeenCalled();
  expect(screen.getByTestId("fork-target-sheet")).toBeTruthy();
  expect(screen.getByText("Same agent")).toBeTruthy();
  fireEvent.press(screen.getByText("GPT-5.5"));
  await waitFor(() =>
    expect(fork).toHaveBeenCalledWith({
      boundary: { kind: "all" },
      ephemeral: false,
      target: { model: "gpt-5.5", provider: "codex" },
    }),
  );
  expect(screen.queryByTestId("fork-target-sheet")).toBeNull();
});
