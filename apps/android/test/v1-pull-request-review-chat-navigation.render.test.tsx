import { render } from "@testing-library/react-native";
import { act, fireEvent, waitFor } from "expo-router/testing-library";
import type { ReactElement } from "react";

import { renderProductionPullRequestRouter } from "./fixtures/PullRequestProductionRouter";
import { productionReviewThread } from "./fixtures/PullRequestProductionScreens";

type MockPresented = {
  readonly closed: boolean;
  readonly didClose: () => void;
  readonly render: (controls: { readonly close: () => void }) => ReactElement | null;
  readonly scope: string;
};

const mockPresented: MockPresented[] = [];

jest.mock("react-native-reanimated/mock", () => {
  const mock = jest.requireActual("./mocks/Reanimated");
  return { __esModule: true, ...mock };
});
jest.mock("expo-router", () => {
  const hooks = jest.requireActual("expo-router/build/hooks");
  const { Stack: RealStack } = jest.requireActual("expo-router/build/layouts/Stack");
  const { useIsFocused: useRealIsFocused } = jest.requireActual("expo-router/build/useIsFocused");
  return {
    Stack: RealStack,
    useIsFocused: useRealIsFocused,
    useLocalSearchParams: hooks.useLocalSearchParams,
    usePathname: hooks.usePathname,
    useRouter: hooks.useRouter,
  };
});
jest.mock("expo-symbols", () => ({}));
jest.mock("../src/data/forgeRuntime", () => ({
  forgeResources: {},
  reviewResources: {},
}));
jest.mock("../src/data/forgeQueryResource", () => ({ useForgeQuery: () => ({}) }));
jest.mock("../src/data/forgeRemoteValue", () => ({ remoteValue: () => null }));
jest.mock("../src/data/minuteClock", () => ({ useMinuteClock: () => 0 }));
jest.mock("../src/features/pullRequestDetail/actions/usePullRequestActions", () => ({
  usePullRequestActions: () => ({
    dismissInput: jest.fn(),
    pendingInput: null,
    run: jest.fn(),
    submitInput: jest.fn(),
  }),
}));
jest.mock("../src/features/pullRequestDetail/actions/ExtensionInputSheet", () => ({
  ExtensionInputSheet: () => null,
}));
jest.mock("../src/features/pullRequestDetail/OverviewPane", () => ({
  OverviewPane: jest.requireActual("./fixtures/PullRequestProductionScreens")
    .ProductionPullRequestOverview,
}));
jest.mock("../src/features/pullRequestDetail/PullRequestAppBar", () => ({
  PullRequestAppBar: () => null,
}));
jest.mock("../src/features/pullRequestDetail/changes/PullRequestChanges", () => ({
  PullRequestChanges: () => null,
}));
jest.mock("../src/features/pullRequestDetail/usePullRequestScreen", () => ({
  threadTitle: () => "Linked thread",
  usePullRequestScreen: jest.requireActual("./fixtures/PullRequestProductionScreens")
    .useProductionPullRequestScreen,
}));
jest.mock("../src/features/workspace/createWorkspaceFeatures", () => ({
  workspaceFeatures: {
    composer: { sendText: jest.fn() },
    conversation: { loadTurnItems: jest.fn() },
    pullRequestDetail: { ensureReviewChat: jest.fn() },
    reviewTarget: {},
  },
}));
jest.mock("../src/routeComposition/linkedThreadDescriptions", () => ({
  useLinkedThreadDescriptions: () => () => null,
}));
jest.mock("../src/routeComposition/LinkedPullRequestChipProvider", () => ({
  LinkedPullRequestChipProvider: ({ children }: { readonly children: React.ReactNode }) => children,
}));
jest.mock("../src/routeComposition/PullRequestReviewChatDraftPane", () => ({
  PullRequestReviewChatDraftPane: jest.requireActual("./fixtures/PullRequestProductionScreens")
    .ProductionPullRequestDraft,
}));
jest.mock("../src/routeComposition/PullRequestsCatalogRoute", () => ({
  PullRequestsPreviewRoute: () => null,
}));
jest.mock("../src/features/workspace/WorkspaceConversationProviders", () => ({
  WorkspaceConversationProviders: ({ children }: { readonly children: React.ReactNode }) =>
    children,
}));
jest.mock("../src/features/conversation/ConversationWorkspace", () => ({
  ActiveWorkspaceConversation: jest.requireActual("./fixtures/ConversationNavigationProbe")
    .ConversationNavigationProbe,
}));
jest.mock("../src/rendering/reduced-motion-store", () => ({
  useReducedMotionPreference: () => true,
}));
jest.mock("../src/services/workspace/workspaceRouteResources", () => ({
  useWorkspaceRouteResources: () => ({
    connections: [],
    desktop: true,
    list: {
      loadedThreadSummaries: [],
      prepareThreadLink: jest.fn(),
      servers: [],
    },
    openBrowser: jest.fn(),
    recovery: {},
    runtime: { ready: false, resources: null, threadDetails: {}, threadSummaries: [] },
    viewportWidth: 1200,
  }),
}));
jest.mock("../src/ui/AppFullscreenOverlay", () => ({
  useAppFullscreenOverlay: ({
    lifecycle,
    scope,
  }: {
    readonly lifecycle?: { readonly didClose?: () => void };
    readonly scope: string;
  }) => ({
    present: (renderEntry: MockPresented["render"]) => {
      const entry = {
        closed: false,
        didClose: () => lifecycle?.didClose?.(),
        render: renderEntry,
        scope,
      };
      mockPresented.push(entry);
      return {
        close: () => {
          entry.closed = true;
        },
      };
    },
  }),
}));

function mockMarker(testID: string) {
  const { Text } = jest.requireActual("react-native");
  return function Marker(props: {
    readonly onClose?: () => void;
    readonly visible?: boolean;
  }): React.JSX.Element {
    return (
      <Text onPress={props.onClose} testID={testID}>
        {props.visible === false ? "hidden" : "shown"}
      </Text>
    );
  };
}

jest.mock("../src/features/conversation/content/ContentDocumentViewer", () => ({
  ContentDocumentViewer: mockMarker("content-document-viewer"),
}));
jest.mock("../src/features/conversation/content/CommandContentViewer", () => ({
  CommandContentViewer: mockMarker("command-content-viewer"),
}));
jest.mock("../src/features/changes/RouteChangesWorkspace", () => ({
  CurrentChangesRoute: mockMarker("current-changes"),
  TurnChangesRoute: mockMarker("turn-changes"),
}));
jest.mock("../src/features/changes/RouteCodeDocumentReview", () => ({
  RouteCodeDocumentReview: mockMarker("code-document"),
}));
jest.mock("../src/features/attachments/RouteDocumentPreview", () => ({
  RouteDocumentPreview: mockMarker("document-preview"),
}));
jest.mock("../src/features/attachments/ThreadAttachmentsRoute", () => ({
  ThreadAttachmentsRoute: mockMarker("attachments-sheet"),
}));
jest.mock("../src/features/conversation/turns/BackgroundTaskOutputScreen", () => ({
  BackgroundTaskOutputScreen: mockMarker("task-output"),
}));
jest.mock("../src/features/terminal/TerminalWorkspace", () => ({
  TerminalWorkspace: mockMarker("terminal"),
}));
jest.mock("../src/features/conversation/SubagentConversation", () => ({
  SubagentConversation: mockMarker("subagent-conversation"),
}));
jest.mock("../src/features/agents/SubagentSheet", () => ({
  SubagentSheet: mockMarker("subagents"),
}));
jest.mock("../src/features/composer/ComposerActionRoutes", () => ({
  ComposerGoalRoute: mockMarker("goal-sheet"),
  ComposerQueueRoute: mockMarker("queue-sheet"),
  ComposerReviewRoute: mockMarker("review-sheet"),
}));

const PULL_REQUEST_PATH = "/pulls/server/fpr1.github-91";

beforeEach(() => {
  mockPresented.length = 0;
  productionReviewThread.current = { threadId: "review-thread", title: "Review chat" };
});

async function renderReviewChat() {
  const view = renderProductionPullRequestRouter();
  fireEvent.press(view.getByTestId("pull-request-linked-chat"));
  await waitFor(() => {
    expect(view.getByTestId("probe-conversation")).toBeVisible();
  });
  expect(view.getPathname()).toBe(PULL_REQUEST_PATH);
  return view;
}

function openEntries(): readonly MockPresented[] {
  return mockPresented.filter((entry) => !entry.closed);
}

function renderPresented(entry: MockPresented) {
  const content = entry.render({ close: jest.fn() });
  if (content === null) {
    throw new Error("Expected presented content");
  }
  return render(content);
}

it("opens a tapped bubble's full message over the PR route, not in Threads", async () => {
  const view = await renderReviewChat();

  fireEvent.press(view.getByLabelText("Open full message"));

  expect(view.getPathname()).toBe(PULL_REQUEST_PATH);
  expect(view.getByTestId("probe-conversation")).toBeVisible();
  expect(view.queryByTestId("production-canonical-thread")).toBeNull();
  const [entry] = openEntries();
  expect(openEntries()).toHaveLength(1);
  expect(entry?.scope).toMatch(/^pane-content:/u);
  const content = renderPresented(entry as MockPresented);
  expect(content.getByTestId("content-document-viewer")).toBeTruthy();
});

it.each([
  ["openAgents", "pane-agents:", "subagents"],
  ["openChanges", "pane-changes:", "current-changes"],
  ["openCodeDocument", "pane-codeDocument:", "code-document"],
  ["openContent", "pane-content:", "command-content-viewer"],
  ["openDocument", "pane-document:", "document-preview"],
  ["openTaskOutput", "pane-taskOutput:", "task-output"],
  ["openTerminal", "pane-terminal:", "terminal"],
  ["openTurnChanges", "pane-turnChanges:", "turn-changes"],
] as const)(
  "presents %s as a fullscreen entry over the PR route",
  async (intent, scope, marker) => {
    const view = await renderReviewChat();

    fireEvent.press(view.getByText(intent));

    expect(view.getPathname()).toBe(PULL_REQUEST_PATH);
    expect(view.queryByTestId("production-canonical-thread")).toBeNull();
    const entries = openEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.scope.startsWith(scope)).toBe(true);
    expect(renderPresented(entries[0] as MockPresented).getByTestId(marker)).toBeTruthy();
  },
);

it("presents tool and attachment sheets over the PR route and closes them in place", async () => {
  const view = await renderReviewChat();

  fireEvent.press(view.getByText("openTool"));
  expect(view.getPathname()).toBe(PULL_REQUEST_PATH);
  expect(view.getByTestId("queue-sheet")).toHaveTextContent("shown");

  fireEvent.press(view.getByText("openAttachments"));
  expect(view.getPathname()).toBe(PULL_REQUEST_PATH);
  // The newer sheet covers the earlier one, which stays mounted but hidden.
  expect(view.getByTestId("attachments-sheet")).toHaveTextContent("shown");
  expect(view.getByTestId("queue-sheet")).toHaveTextContent("hidden");
  expect(openEntries()).toHaveLength(0);

  fireEvent.press(view.getByTestId("attachments-sheet"));
  expect(view.queryByTestId("attachments-sheet")).toBeNull();
  expect(view.getByTestId("queue-sheet")).toHaveTextContent("shown");
  fireEvent.press(view.getByTestId("queue-sheet"));
  expect(view.queryByTestId("queue-sheet")).toBeNull();
  expect(view.getPathname()).toBe(PULL_REQUEST_PATH);
  expect(view.getByTestId("probe-conversation")).toBeVisible();
});

it("closes the entries a closed entry covered and keeps the earlier ones", async () => {
  const view = await renderReviewChat();

  fireEvent.press(view.getByText("openChanges"));
  fireEvent.press(view.getByText("openDocument"));
  fireEvent.press(view.getByText("openTerminal"));
  expect(openEntries().map((entry) => entry.scope.split(":")[0])).toEqual([
    "pane-changes",
    "pane-document",
    "pane-terminal",
  ]);

  act(() => {
    openEntries()[1]?.didClose();
  });

  await waitFor(() => {
    expect(openEntries().map((entry) => entry.scope.split(":")[0])).toEqual(["pane-changes"]);
  });
  expect(view.getPathname()).toBe(PULL_REQUEST_PATH);
  expect(view.getByTestId("probe-conversation")).toBeVisible();
});
