import { fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import type { ThreadForkOptions } from "../src/data/thread-fork";
import { parseAgentProviderId, type AgentProviderId } from "../src/data/threadAgent";
import type { TurnControlsModel } from "../src/data/turn-controls-types";
import { useThreadTimelineActions } from "../src/features/conversation/timeline/ThreadTimeline";
import { ThreadHeaderMenu } from "../src/features/turnActions/ThreadActions";
import { ThreadForkSheet } from "../src/features/turnActions/ThreadForkSheet";
import { useForkTargetPicker } from "../src/features/turnActions/forkTargetPicker";
import { forkOffer } from "../src/features/turnActions/forkTargets";
import { AppNoticeContext } from "../src/ui/appNoticeContext";

// WHY: the native sheet window cannot mount in the Node renderer; the sheet's content is the contract here.
jest.mock("../src/ui/AppSheet", () => {
  const { View: MockView } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    AppSheet: ({ children }: { readonly children: ReactNode }) => <MockView>{children}</MockView>,
    AppSheetScrollView: ({ children }: { readonly children: ReactNode }) => (
      <MockView>{children}</MockView>
    ),
  };
});

function provider(id: string): AgentProviderId {
  const parsed = parseAgentProviderId(id);
  if (parsed === null) throw new Error(`invalid provider fixture ${id}`);
  return parsed;
}

function model(id: string, label: string, owner: string | null): TurnControlsModel {
  return {
    defaultEffort: "high",
    efforts: ["high"],
    id,
    isDefault: false,
    label,
    provider: owner === null ? null : provider(owner),
    supportsPersonality: false,
  };
}

const catalog = [
  model("gpt-5.5", "GPT-5.5", "codex"),
  model("gpt-5.4", "GPT-5.4", "codex"),
  model("opus", "Opus", "claude"),
  model("sonnet", "Sonnet", "claude"),
];

function thread(owner: string, capabilities: Record<string, boolean>) {
  return {
    codewideAgent: { capabilities, primary: owner === "codex", provider: owner, providerName: owner },
  };
}

const ownFork = thread("codex", { "threads.fork": true });
const bothForks = thread("codex", { "threads.crossProviderFork": true, "threads.fork": true });
const crossOnly = thread("claude", { "threads.crossProviderFork": true });

function Wrapper(props: { readonly children: ReactNode }) {
  return (
    // WHY: the header reads the notice controller only for copy feedback, which these tests do not use.
    <AppNoticeContext.Provider value={{ show: jest.fn() } as never}>
      <View>{props.children}</View>
    </AppNoticeContext.Provider>
  );
}

/** The header menu, a message's fork action and the conversation's fork sheet over one picker. */
function Conversation(props: {
  readonly currentModel: string | null;
  readonly fork: (options: ThreadForkOptions) => Promise<void>;
  readonly thread: unknown;
}) {
  const picker = useForkTargetPicker("scope");
  const readOffer = () => forkOffer(props.thread, props.currentModel, catalog);
  const timeline = useThreadTimelineActions(
    undefined,
    (turnId) => {
      picker.openFork({ kind: "through", turnId }, readOffer);
    },
    undefined,
  );
  return (
    <>
      <ThreadHeaderMenu
        archived={false}
        forkOffer={readOffer}
        forkPicker={picker}
        onFork={props.fork}
        onRenameRequest={jest.fn()}
        pinned={false}
        threadId="t1"
      />
      <Pressable
        accessibilityLabel="Message fork"
        onPress={() => {
          timeline.forkThroughTurn("turn-7");
        }}
      />
      <ThreadForkSheet onFork={props.fork} picker={picker} />
    </>
  );
}

function renderConversation(threadValue: unknown, currentModel: string | null = "gpt-5.5") {
  const fork = jest.fn(async (_options: ThreadForkOptions) => undefined);
  const screen = render(
    <Conversation currentModel={currentModel} fork={fork} thread={threadValue} />,
    { wrapper: Wrapper },
  );
  return { fork, screen };
}

function openHeaderFork(screen: ReturnType<typeof render>) {
  fireEvent.press(screen.getAllByLabelText("Thread menu")[0]!);
  fireEvent.press(screen.getByLabelText("Thread menu: Fork thread"));
}

/** Labels of the offered model rows: the buttons that report a selection state. */
function offeredModels(screen: ReturnType<typeof render>): unknown[] {
  return screen
    .queryAllByRole("button")
    .filter((element) => element.props.accessibilityState?.selected !== undefined)
    .map((element) => element.props.accessibilityLabel);
}

it("forks with the thread's current model and sends no target", async () => {
  const { fork, screen } = renderConversation(ownFork);
  openHeaderFork(screen);
  expect(screen.getByTestId("fork-sheet")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Choose model, GPT-5.5" })).toBeTruthy();
  expect(fork).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole("button", { name: "Fork" }));
  await waitFor(() =>
    expect(fork).toHaveBeenCalledWith({ boundary: { kind: "all" }, ephemeral: false, target: null }),
  );
  expect(screen.queryByTestId("fork-sheet")).toBeNull();
});

it("forks into another model of the thread's provider when the user picks it", async () => {
  const { fork, screen } = renderConversation(ownFork);
  openHeaderFork(screen);
  fireEvent.press(screen.getByRole("button", { name: "Choose model, GPT-5.5" }));
  fireEvent.press(screen.getByRole("button", { name: "GPT-5.4" }));
  expect(screen.getByRole("button", { name: "Choose model, GPT-5.4" })).toBeTruthy();
  expect(screen.queryByTestId("fork-handoff-note")).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Fork" }));
  await waitFor(() =>
    expect(fork).toHaveBeenCalledWith({
      boundary: { kind: "all" },
      ephemeral: false,
      target: { model: "gpt-5.4", provider: "codex" },
    }),
  );
});

it("forks into another provider's model and groups the offer by provider", async () => {
  const { fork, screen } = renderConversation(bothForks);
  openHeaderFork(screen);
  fireEvent.press(screen.getByRole("button", { name: "Choose model, GPT-5.5" }));
  expect(screen.getByTestId("model-provider-section-codex")).toBeTruthy();
  expect(screen.getByTestId("model-provider-section-claude")).toBeTruthy();
  expect(screen.queryByTestId("fork-handoff-note")).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Opus" }));
  // Another agent starts from a summary of the chat, and the sheet says so.
  expect(screen.getByTestId("fork-handoff-note")).toHaveTextContent(/Claude.*summary/u);
  fireEvent.press(screen.getByRole("button", { name: "Fork" }));
  await waitFor(() =>
    expect(fork).toHaveBeenCalledWith({
      boundary: { kind: "all" },
      ephemeral: false,
      target: { model: "opus", provider: "claude" },
    }),
  );
});

it("returns to the plain fork when the user picks the current model again", async () => {
  const { fork, screen } = renderConversation(bothForks);
  openHeaderFork(screen);
  fireEvent.press(screen.getByRole("button", { name: "Choose model, GPT-5.5" }));
  fireEvent.press(screen.getByRole("button", { name: "Sonnet" }));
  fireEvent.press(screen.getByRole("button", { name: "Choose model, Sonnet" }));
  fireEvent.press(screen.getByRole("button", { name: "GPT-5.5" }));
  fireEvent.press(screen.getByRole("button", { name: "Fork" }));
  await waitFor(() =>
    expect(fork).toHaveBeenCalledWith({ boundary: { kind: "all" }, ephemeral: false, target: null }),
  );
});

it("opens the same sheet from a message and keeps its through-turn boundary", async () => {
  const { fork, screen } = renderConversation(bothForks);
  fireEvent.press(screen.getByLabelText("Message fork"));
  expect(screen.getByRole("button", { name: "Choose model, GPT-5.5" })).toBeTruthy();
  fireEvent.press(screen.getByRole("button", { name: "Choose model, GPT-5.5" }));
  fireEvent.press(screen.getByRole("button", { name: "Opus" }));
  fireEvent.press(screen.getByRole("button", { name: "Fork" }));
  await waitFor(() =>
    expect(fork).toHaveBeenCalledWith({
      boundary: { kind: "through", turnId: "turn-7" },
      ephemeral: false,
      target: { model: "opus", provider: "claude" },
    }),
  );
});

it("offers only the thread provider's models without a cross-provider fork", () => {
  const { screen } = renderConversation(ownFork);
  openHeaderFork(screen);
  fireEvent.press(screen.getByRole("button", { name: "Choose model, GPT-5.5" }));
  expect(offeredModels(screen)).toEqual(["GPT-5.5", "GPT-5.4"]);
  expect(screen.queryByTestId("model-provider-section-codex")).toBeNull();
});

it("requires another provider's model when the agent cannot fork into itself", async () => {
  const { fork, screen } = renderConversation(crossOnly, "sonnet");
  openHeaderFork(screen);
  expect(offeredModels(screen)).toEqual(["GPT-5.5", "GPT-5.4"]);
  const forkButton = screen.getByRole("button", { name: "Fork" });
  expect(forkButton.props.accessibilityState).toEqual({ disabled: true });
  fireEvent.press(forkButton);
  expect(fork).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole("button", { name: "GPT-5.4" }));
  fireEvent.press(screen.getByRole("button", { name: "Fork" }));
  await waitFor(() =>
    expect(fork).toHaveBeenCalledWith({
      boundary: { kind: "all" },
      ephemeral: false,
      target: { model: "gpt-5.4", provider: "codex" },
    }),
  );
});

it("offers a legacy thread the whole catalog with its current model preselected", async () => {
  const { fork, screen } = renderConversation({});
  openHeaderFork(screen);
  fireEvent.press(screen.getByRole("button", { name: "Choose model, GPT-5.5" }));
  expect(offeredModels(screen)).toEqual(["GPT-5.5", "GPT-5.4", "Opus", "Sonnet"]);
  fireEvent.press(screen.getByRole("button", { name: "GPT-5.5", selected: true }));
  fireEvent.press(screen.getByRole("button", { name: "Fork" }));
  await waitFor(() =>
    expect(fork).toHaveBeenCalledWith({ boundary: { kind: "all" }, ephemeral: false, target: null }),
  );
});
