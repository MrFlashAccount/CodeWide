import { fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import type { ThreadForkOptions } from "../src/data/thread-fork";
import { parseAgentProviderId, type AgentProviderId } from "../src/data/threadAgent";
import type {
  TurnControlsModel,
  TurnControlsModelReasoning,
} from "../src/data/turn-controls-types";
import { useThreadTimelineActions } from "../src/features/conversation/timeline/ThreadTimeline";
import { ThreadHeaderMenu } from "../src/features/turnActions/ThreadActions";
import { ThreadForkSheet } from "../src/features/turnActions/ThreadForkSheet";
import { useForkTargetPicker } from "../src/features/turnActions/forkTargetPicker";
import { forkOffer, type ForkThreadSettings } from "../src/features/turnActions/forkTargets";
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

const codexLevels: TurnControlsModelReasoning = {
  defaultEffort: "medium",
  efforts: ["low", "medium", "high", "xhigh"],
};

function model(
  id: string,
  label: string,
  owner: string,
  reasoning: TurnControlsModelReasoning = codexLevels,
  serviceTiers: TurnControlsModel["serviceTiers"] = [],
): TurnControlsModel {
  return {
    ...reasoning,
    id,
    isDefault: false,
    label,
    provider: provider(owner),
    serviceTiers,
    supportsPersonality: false,
  };
}

const catalog = [
  model("gpt-5.5", "GPT-5.5", "codex", codexLevels, [
    { description: "Faster", id: "priority", name: "Fast" },
  ]),
  model("gpt-5.4", "GPT-5.4", "codex"),
  model("opus", "Opus", "claude", { defaultEffort: "high", efforts: ["low", "medium", "high"] }),
  model("haiku", "Haiku", "claude", { defaultEffort: null, efforts: [] }),
];

function thread(owner: string, capabilities: Record<string, boolean>) {
  return {
    codewideAgent: { capabilities, primary: owner === "codex", provider: owner, providerName: owner },
  };
}

const ownFork = thread("codex", { "threads.fork": true });
const bothForks = thread("codex", { "threads.crossProviderFork": true, "threads.fork": true });
const crossOnly = thread("claude", { "threads.crossProviderFork": true });

const codexSettings = { effort: "high", model: "gpt-5.5", serviceTier: null };

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
  readonly fork: (options: ThreadForkOptions) => Promise<void>;
  readonly settings: ForkThreadSettings;
  readonly thread: unknown;
}) {
  const picker = useForkTargetPicker("scope");
  const readOffer = () => forkOffer(props.thread, props.settings, catalog);
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

function renderConversation(threadValue: unknown, settings: ForkThreadSettings = codexSettings) {
  const fork = jest.fn(async (_options: ThreadForkOptions) => undefined);
  const screen = render(<Conversation fork={fork} settings={settings} thread={threadValue} />, {
    wrapper: Wrapper,
  });
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

/** The "Who continues" cards: provider id and whether each is chosen or unavailable. */
function agentCards(screen: ReturnType<typeof render>) {
  return screen.getAllByRole("radio").map((card) => ({
    id: String(card.props.testID).replace("fork-agent-", ""),
    state: card.props.accessibilityState,
  }));
}

it("forks with the thread's own agent and settings and sends no target", async () => {
  const { fork, screen } = renderConversation(bothForks);
  openHeaderFork(screen);
  expect(screen.getByTestId("fork-boundary")).toHaveTextContent("The whole chat");
  expect(agentCards(screen)).toEqual([
    { id: "codex", state: { checked: true, disabled: false } },
    { id: "claude", state: { checked: false, disabled: false } },
  ]);
  expect(screen.getByRole("button", { name: "Choose model, GPT-5.5" })).toBeTruthy();
  expect(screen.getByLabelText("Thinking level, High")).toBeTruthy();
  expect(screen.getByTestId("fork-summary")).toHaveTextContent(
    "GPT-5.5 · High thinking · full history",
  );
  expect(screen.queryByTestId("fork-handoff-note")).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Fork chat" }));
  await waitFor(() =>
    expect(fork).toHaveBeenCalledWith({ boundary: { kind: "all" }, ephemeral: false, target: null }),
  );
  expect(screen.queryByTestId("fork-sheet")).toBeNull();
});

it("forks with another thinking level and Fast of the same model", async () => {
  const { fork, screen } = renderConversation(ownFork);
  openHeaderFork(screen);
  fireEvent(screen.getByLabelText("Thinking level, High"), "accessibilityAction", {
    nativeEvent: { actionName: "increment" },
  });
  fireEvent.press(screen.getByRole("switch", { name: "Fast mode" }));
  expect(screen.getByTestId("fork-summary")).toHaveTextContent(
    "GPT-5.5 · Extra high thinking · Fast · full history",
  );
  fireEvent.press(screen.getByRole("button", { name: "Fork chat" }));
  await waitFor(() =>
    expect(fork).toHaveBeenCalledWith({
      boundary: { kind: "all" },
      ephemeral: false,
      target: { effort: "xhigh", model: "gpt-5.5", provider: "codex", serviceTier: "priority" },
    }),
  );
});

it("keeps the chosen thinking level when switching to another model of the agent", async () => {
  const { fork, screen } = renderConversation(ownFork);
  openHeaderFork(screen);
  fireEvent.press(screen.getByRole("button", { name: "Choose model, GPT-5.5" }));
  expect(offeredModels(screen)).toEqual(["GPT-5.5", "GPT-5.4"]);
  fireEvent.press(screen.getByRole("button", { name: "GPT-5.4" }));
  // GPT-5.4 has no Fast tier.
  expect(screen.queryByRole("switch", { name: "Fast mode" })).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Fork chat" }));
  await waitFor(() =>
    expect(fork).toHaveBeenCalledWith({
      boundary: { kind: "all" },
      ephemeral: false,
      target: { effort: "high", model: "gpt-5.4", provider: "codex", serviceTier: null },
    }),
  );
});

it("forks into another agent from a summary with that agent's models only", async () => {
  const { fork, screen } = renderConversation(bothForks);
  openHeaderFork(screen);
  fireEvent.press(screen.getByTestId("fork-agent-claude"));
  // Another agent starts from a summary of the chat, and the sheet says so.
  expect(screen.getByTestId("fork-handoff-note")).toHaveTextContent(/Claude.*Codex.*summary/u);
  expect(screen.getByTestId("fork-summary")).toHaveTextContent(
    "Opus · High thinking · from a summary",
  );
  fireEvent.press(screen.getByRole("button", { name: "Choose model, Opus" }));
  expect(offeredModels(screen)).toEqual(["Opus", "Haiku"]);
  fireEvent.press(screen.getByRole("button", { name: "Haiku" }));
  // A model without thinking levels shows no slider.
  expect(screen.queryByLabelText(/Thinking level/u)).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Fork into Claude" }));
  await waitFor(() =>
    expect(fork).toHaveBeenCalledWith({
      boundary: { kind: "all" },
      ephemeral: false,
      target: { effort: null, model: "haiku", provider: "claude", serviceTier: null },
    }),
  );
});

it("returns to the plain fork when the user picks the thread's own agent again", async () => {
  const { fork, screen } = renderConversation(bothForks);
  openHeaderFork(screen);
  fireEvent.press(screen.getByTestId("fork-agent-claude"));
  fireEvent.press(screen.getByTestId("fork-agent-codex"));
  expect(screen.queryByTestId("fork-handoff-note")).toBeNull();
  fireEvent.press(screen.getByRole("button", { name: "Fork chat" }));
  await waitFor(() =>
    expect(fork).toHaveBeenCalledWith({ boundary: { kind: "all" }, ephemeral: false, target: null }),
  );
});

it("opens the same sheet from a message and keeps its through-turn boundary", async () => {
  const { fork, screen } = renderConversation(bothForks);
  fireEvent.press(screen.getByLabelText("Message fork"));
  expect(screen.getByTestId("fork-boundary")).toHaveTextContent("Up to this message");
  fireEvent.press(screen.getByTestId("fork-agent-claude"));
  fireEvent.press(screen.getByRole("button", { name: "Fork into Claude" }));
  await waitFor(() =>
    expect(fork).toHaveBeenCalledWith({
      boundary: { kind: "through", turnId: "turn-7" },
      ephemeral: false,
      target: { effort: "high", model: "opus", provider: "claude", serviceTier: null },
    }),
  );
});

it("offers only the thread's own agent without a cross-provider fork", () => {
  const { screen } = renderConversation(ownFork);
  openHeaderFork(screen);
  expect(agentCards(screen)).toEqual([{ id: "codex", state: { checked: true, disabled: false } }]);
});

it("preselects another agent when the thread's agent cannot fork into itself", async () => {
  const { fork, screen } = renderConversation(crossOnly, {
    effort: null,
    model: "opus",
    serviceTier: null,
  });
  openHeaderFork(screen);
  expect(agentCards(screen)).toEqual([
    { id: "claude", state: { checked: false, disabled: true } },
    { id: "codex", state: { checked: true, disabled: false } },
  ]);
  fireEvent.press(screen.getByTestId("fork-agent-claude"));
  fireEvent.press(screen.getByRole("button", { name: "Fork into Codex" }));
  await waitFor(() =>
    expect(fork).toHaveBeenCalledWith({
      boundary: { kind: "all" },
      ephemeral: false,
      target: { effort: "medium", model: "gpt-5.5", provider: "codex", serviceTier: null },
    }),
  );
});

it("offers a legacy thread every agent with its current settings preselected", async () => {
  const { fork, screen } = renderConversation({});
  openHeaderFork(screen);
  expect(agentCards(screen).map((card) => card.id)).toEqual(["codex", "claude"]);
  fireEvent.press(screen.getByRole("button", { name: "Choose model, GPT-5.5" }));
  fireEvent.press(screen.getByRole("button", { name: "GPT-5.5", selected: true }));
  fireEvent.press(screen.getByRole("button", { name: "Fork chat" }));
  await waitFor(() =>
    expect(fork).toHaveBeenCalledWith({ boundary: { kind: "all" }, ephemeral: false, target: null }),
  );
});
