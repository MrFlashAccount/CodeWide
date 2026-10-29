import { act, fireEvent, render, waitFor, within } from "@testing-library/react-native";
import { BackHandler, Text } from "react-native";

import { PullRequestRoute } from "../src/routeComposition/PullRequestRoute";
import { WorkspacePaneFrame } from "../src/routeComposition/WorkspacePaneFrame";
import { getAppDialogRequest, resetAppDialog } from "./mocks/AppDialog";

const mockSelectThread = jest.fn();
const mockPrepareThreadLink = jest.fn();
const mockReplaceWithLinkedThread = jest.fn();
const mockEnsureReviewChat = jest.fn();
const mockSetDetailExpanded = jest.fn();
const mockDismissTo = jest.fn();
const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockBack = jest.fn();
let mockCanGoBack = true;
const mockWorkspaceListeners = new Set<() => void>();
let mockDesktop = true;
let mockViewportWidth = 1200;
let mockParams = { connectionId: "server", pullRequestKey: "fpr1.github-91" };

jest.mock("expo-router", () => ({
  useIsFocused: () => true,
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({
    back: mockBack,
    canGoBack: () => mockCanGoBack,
    dismissTo: mockDismissTo,
    push: mockPush,
    replace: mockReplace,
  }),
}));
jest.mock("../src/data/forgeRuntime", () => ({
  forgeResources: {},
  pullRequestCommentDestinations: {},
  reviewResources: {},
}));
jest.mock("../src/features/pullRequestDetail/PullRequestScreen", () =>
  jest.requireActual("./fixtures/PullRequestRouteScreen"),
);
jest.mock("../src/features/pullRequestDetail/PullRequestScreenSkeleton", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { PullRequestScreenSkeleton: () => <MockText>Loading pull request</MockText> };
});
jest.mock("../src/features/workspace/createWorkspaceFeatures", () => ({
  workspaceFeatures: {
    pullRequestDetail: {
      ensureReviewChat: (...args: unknown[]) => mockEnsureReviewChat(...args),
    },
    composer: { sendText: jest.fn() },
    reviewTarget: {},
  },
}));
jest.mock("../src/routeComposition/linkedThreadDescriptions", () => ({
  useLinkedThreadDescriptions: () => () => null,
}));
jest.mock("../src/routeComposition/pullRequestNavigation", () => ({
  linkedThreadSelectionKey: (connectionId: string, threadId: string) =>
    `${connectionId}:${threadId}`,
  usePullRequestNavigation: () => ({ navigateToLinkedThread: mockReplaceWithLinkedThread }),
}));
jest.mock("../src/routeComposition/PullRequestConversationPane", () => {
  const { Text: MockText, View: MockView } = jest.requireActual("react-native");
  const { PaneChromeControls } = jest.requireActual("./fixtures/PaneChromeControls");
  return {
    PullRequestConversationPane: ({
      chrome,
      threadId,
    }: {
      readonly chrome: unknown;
      readonly threadId: string;
    }) => (
      <MockView>
        <MockText testID="canonical-conversation">{threadId}</MockText>
        <PaneChromeControls chrome={chrome} name="review chat" />
      </MockView>
    ),
  };
});
jest.mock("../src/services/workspace/workspaceRouteResources", () => {
  const { useSyncExternalStore } = jest.requireActual("react");
  return {
    useWorkspaceRouteResources: () => {
      useSyncExternalStore(
        (listener: () => void) => {
          mockWorkspaceListeners.add(listener);
          return () => mockWorkspaceListeners.delete(listener);
        },
        () => `${String(mockDesktop)}:${mockViewportWidth}`,
      );
      return {
        desktop: mockDesktop,
        list: {
          loadedThreadSummaries: [],
          prepareThreadLink: mockPrepareThreadLink,
          selectThread: mockSelectThread,
        },
        runtime: { threadSummaries: null },
        viewportWidth: mockViewportWidth,
      };
    },
  };
});
// WHY: the draft's conversation has its own render coverage; this file proves the route flow.
jest.mock("../src/routeComposition/PullRequestReviewChatDraftPane", () => {
  const { View: MockView } = jest.requireActual("react-native");
  const { PaneChromeControls } = jest.requireActual("./fixtures/PaneChromeControls");
  return {
    PullRequestReviewChatDraftPane: ({ chrome }: { readonly chrome: unknown }) => (
      <MockView testID="pull-request-chat-draft">
        <PaneChromeControls chrome={chrome} name="review chat" />
      </MockView>
    ),
  };
});
jest.mock("../src/routeComposition/pullRequestsPaneController", () => ({
  usePullRequestsPaneController: () => ({
    setDetailExpanded: (_owner: symbol, expanded: boolean) => mockSetDetailExpanded(expanded),
  }),
}));
jest.mock("../src/ui/RecoverableRenderBoundary", () => ({
  RecoverableRenderBoundary: ({ children }: { readonly children: React.ReactNode }) => children,
}));

beforeEach(() => {
  mockWorkspaceListeners.clear();
  mockDesktop = true;
  mockViewportWidth = 1200;
  mockParams = { connectionId: "server", pullRequestKey: "fpr1.github-91" };
  mockSelectThread.mockClear();
  mockPrepareThreadLink.mockClear();
  mockReplaceWithLinkedThread.mockClear();
  mockSetDetailExpanded.mockClear();
  mockDismissTo.mockClear();
  mockReplace.mockClear();
  mockPush.mockClear();
  mockBack.mockClear();
  mockCanGoBack = true;
  mockEnsureReviewChat.mockReset();
  mockEnsureReviewChat.mockImplementation(() => new Promise(() => undefined));
  resetAppDialog();
});

function resizeWorkspace(desktop: boolean, viewportWidth: number): void {
  act(() => {
    mockDesktop = desktop;
    mockViewportWidth = viewportWidth;
    mockWorkspaceListeners.forEach((listener) => listener());
  });
}

it("reveals the review-chat draft immediately, with no opening skeleton, while suggestions resolve", () => {
  mockDesktop = false;
  mockViewportWidth = 400;
  const view = render(<PullRequestRoute tab="overview" />);

  fireEvent.press(view.getByTestId("open-review-chat"));

  expect(view.getByTestId("pull-request-chat-draft")).toBeVisible();
  expect(mockEnsureReviewChat).toHaveBeenCalledWith(
    { connectionId: "server", pullRequest: "fpr1.github-91" },
    { kind: "ask" },
  );
  expect(mockSetDetailExpanded).toHaveBeenCalledWith(true);
});

it("keeps the canonical chat and pane claim current across adaptive width changes", () => {
  const view = render(<PullRequestRoute tab="overview" />);

  fireEvent.press(view.getByTestId("open-linked-thread"));

  const route = view.getByTestId("pull-request-workspace");
  const conversation = view.getByTestId("canonical-conversation");
  expect(conversation).toHaveTextContent("linked-thread");
  expect(mockSetDetailExpanded).toHaveBeenLastCalledWith(false);

  resizeWorkspace(false, 400);
  expect(view.getByTestId("pull-request-workspace")).toBe(route);
  expect(view.getByTestId("canonical-conversation")).toBe(conversation);
  expect(view.getByTestId("pull-request-compact-chat")).toBeVisible();
  expect(mockSetDetailExpanded).toHaveBeenLastCalledWith(true);

  resizeWorkspace(true, 1200);
  expect(view.getByTestId("canonical-conversation")).toBe(conversation);
  expect(mockSetDetailExpanded).toHaveBeenLastCalledWith(false);

  resizeWorkspace(true, 1199);
  expect(mockSetDetailExpanded).toHaveBeenLastCalledWith(true);
  expect(mockSelectThread).not.toHaveBeenCalled();
  expect(mockReplaceWithLinkedThread).not.toHaveBeenCalled();
  expect(mockReplace).not.toHaveBeenCalled();
  expect(mockDismissTo).not.toHaveBeenCalled();
});

type BackListener = () => boolean | null | undefined;

/** Captures Android Back listeners; the newest listener handles Back first. */
function captureSystemBack(): () => boolean {
  let listeners: BackListener[] = [];
  jest.spyOn(BackHandler, "addEventListener").mockImplementation((_event, listener) => {
    listeners.push(listener);
    return {
      remove: () => {
        listeners = listeners.filter((candidate) => candidate !== listener);
      },
    };
  });
  return () => listeners.toReversed().some((listener) => listener() === true);
}

/** The PR route as the center destination of a wide workspace frame with a visible catalog. */
function renderInWideFrame() {
  mockDesktop = true;
  mockViewportWidth = 1600;
  return render(
    <WorkspacePaneFrame
      catalog={<Text testID="catalog">Catalog</Text>}
      catalogFocused={false}
      catalogStatus="present"
      desktop
      detail={<PullRequestRoute tab="overview" />}
      presentation={{ kind: "wide", viewportWidth: 1600 }}
      viewportWidth={1600}
    />,
  );
}

/** Opening the chat beside the PR is a rearrangement: it applies on the next frame. */
async function openLinkedThreadBeside(view: ReturnType<typeof render>): Promise<void> {
  fireEvent.press(view.getByTestId("open-linked-thread"));
  await waitFor(() => {
    expect(view.getByTestId("canonical-conversation")).toBeVisible();
  });
}

it("shows only the right pane's declared actions: fullscreen and close, never widen", async () => {
  const view = renderInWideFrame();
  await openLinkedThreadBeside(view);

  const chat = within(view.getByTestId("pull-request-chat-pane"));
  expect(chat.getByLabelText("review chat menu: Fullscreen")).toBeVisible();
  expect(chat.getByLabelText("Close review chat")).toBeVisible();
  expect(view.queryByText(/Widen|Narrow/u)).toBeNull();
  expect(view.getByLabelText("Open pull request fullscreen")).toBeVisible();
});

it("shows the chat alone in fullscreen within the route tree and keeps every pane mounted", async () => {
  const systemBack = captureSystemBack();
  const view = renderInWideFrame();
  await openLinkedThreadBeside(view);
  const conversation = view.getByTestId("canonical-conversation");
  const pullRequest = view.getByTestId("pull-request-primary-pane");

  fireEvent.press(view.getByLabelText("review chat menu: Fullscreen"));
  await waitFor(() => {
    expect(view.getByLabelText("review chat menu: Exit fullscreen")).toBeVisible();
  });
  expect(view.queryByTestId("catalog")).toBeNull();
  expect(view.getByTestId("catalog", { includeHiddenElements: true })).not.toBeVisible();
  expect(view.queryByTestId("pull-request-primary-pane")).toBeNull();
  expect(view.getByTestId("pull-request-primary-pane", { includeHiddenElements: true })).toBe(
    pullRequest,
  );
  expect(view.getByTestId("canonical-conversation")).toBe(conversation);
  expect(
    within(view.getByTestId("pull-request-workspace")).getByTestId("canonical-conversation"),
  ).toBe(conversation);

  fireEvent.press(view.getByLabelText("review chat menu: Exit fullscreen"));
  await waitFor(() => {
    expect(view.getByTestId("pull-request-primary-pane")).toBeVisible();
  });
  expect(view.getByTestId("catalog")).toBeVisible();
  expect(view.getByTestId("canonical-conversation")).toBe(conversation);

  fireEvent.press(view.getByLabelText("review chat menu: Fullscreen"));
  await waitFor(() => {
    expect(view.getByLabelText("review chat menu: Exit fullscreen")).toBeVisible();
  });
  expect(view.queryByTestId("pull-request-primary-pane")).toBeNull();
  act(() => {
    expect(systemBack()).toBe(true);
  });
  await waitFor(() => {
    expect(view.getByTestId("pull-request-primary-pane")).toBeVisible();
  });
  expect(view.getByTestId("canonical-conversation")).toBe(conversation);
  expect(systemBack()).toBe(false);
  jest.restoreAllMocks();
});

it("returns to the PR when the fullscreen chat closes", async () => {
  const view = renderInWideFrame();
  await openLinkedThreadBeside(view);
  fireEvent.press(view.getByLabelText("review chat menu: Fullscreen"));
  await waitFor(() => {
    expect(view.getByLabelText("review chat menu: Exit fullscreen")).toBeVisible();
  });
  expect(view.queryByTestId("pull-request-primary-pane")).toBeNull();

  fireEvent.press(view.getByLabelText("Close review chat"));
  await waitFor(() => {
    expect(view.getByTestId("pull-request-primary-pane")).toBeVisible();
  });
  expect(view.queryByTestId("canonical-conversation", { includeHiddenElements: true })).toBeNull();
  expect(view.getByTestId("catalog")).toBeVisible();
});

it("shows the PR alone in fullscreen while the chat stays mounted", async () => {
  const view = renderInWideFrame();
  await openLinkedThreadBeside(view);
  const conversation = view.getByTestId("canonical-conversation");

  fireEvent.press(view.getByLabelText("Open pull request fullscreen"));
  await waitFor(() => {
    expect(view.getByLabelText("Exit pull request fullscreen")).toBeVisible();
  });
  expect(view.queryByTestId("catalog")).toBeNull();
  expect(view.queryByTestId("canonical-conversation")).toBeNull();
  expect(view.getByTestId("canonical-conversation", { includeHiddenElements: true })).toBe(
    conversation,
  );

  fireEvent.press(view.getByLabelText("Exit pull request fullscreen"));
  await waitFor(() => {
    expect(view.getByTestId("canonical-conversation")).toBeVisible();
  });
  expect(view.getByTestId("canonical-conversation")).toBe(conversation);
});

it("offers no pane fullscreen where panes do not sit side by side", () => {
  mockDesktop = false;
  mockViewportWidth = 400;
  const view = render(<PullRequestRoute tab="overview" />);
  fireEvent.press(view.getByTestId("open-review-chat"));

  expect(view.getByTestId("pull-request-chat-draft")).toBeVisible();
  expect(view.queryByLabelText("review chat menu: Fullscreen")).toBeNull();
  expect(view.queryByLabelText(/fullscreen/iu)).toBeNull();
  fireEvent.press(view.getByLabelText("Close review chat"));
  expect(view.queryByTestId("pull-request-chat-draft")).toBeNull();
  expect(mockSetDetailExpanded).toHaveBeenLastCalledWith(false);
});

it("covers the PR with the compact draft and restores the PR pane on close", () => {
  mockDesktop = false;
  mockViewportWidth = 400;
  const view = render(<PullRequestRoute tab="overview" />);

  fireEvent.press(view.getByTestId("open-review-chat"));

  expect(view.getByTestId("pull-request-chat-draft")).toBeVisible();
  expect(view.getByTestId("pull-request-primary-pane", { includeHiddenElements: true })).toHaveProp(
    "importantForAccessibility",
    "no-hide-descendants",
  );
  expect(view.getAllByRole("button").map((button) => button.props.accessibilityLabel)).toEqual([
    "Close review chat",
  ]);

  fireEvent.press(view.getByLabelText("Close review chat"));
  expect(view.getByTestId("pull-request-primary-pane")).toHaveProp(
    "importantForAccessibility",
    "auto",
  );
  expect(view.getByTestId("open-review-chat")).toBeVisible();
});

it("opens a chat the overview names directly: prepares, then navigates on a phone", () => {
  mockDesktop = false;
  const order: string[] = [];
  mockPrepareThreadLink.mockImplementation(() => {
    order.push("prepare");
  });
  mockReplaceWithLinkedThread.mockImplementation(() => {
    order.push("replace");
  });
  const view = render(<PullRequestRoute tab="overview" />);

  fireEvent.press(view.getByTestId("open-existing-review-chat"));

  expect(order).toEqual(["prepare", "replace"]);
  expect(mockReplaceWithLinkedThread).toHaveBeenCalledWith("server", "existing-thread");
  expect(mockEnsureReviewChat).not.toHaveBeenCalled();
  expect(view.queryByTestId("pull-request-chat-draft")).toBeNull();
});

it("navigates to a live linked chat the suggestion request finds, in order", async () => {
  mockDesktop = false;
  const pending = Promise.withResolvers<{
    readonly created: boolean;
    readonly kind: "ready";
    readonly threadId: string;
  }>();
  const order: string[] = [];
  mockEnsureReviewChat.mockImplementation(() => pending.promise);
  mockPrepareThreadLink.mockImplementation(() => {
    order.push("prepare");
  });
  mockReplaceWithLinkedThread.mockImplementation(() => {
    order.push("replace");
  });
  const view = render(<PullRequestRoute tab="overview" />);

  fireEvent.press(view.getByTestId("open-review-chat", { includeHiddenElements: true }));
  await act(async () => {
    pending.resolve({ created: false, kind: "ready", threadId: "linked-thread" });
    await pending.promise;
  });
  await waitFor(() => {
    expect(mockReplaceWithLinkedThread).toHaveBeenCalledWith("server", "linked-thread");
  });

  expect(mockEnsureReviewChat).toHaveBeenCalledWith(
    { connectionId: "server", pullRequest: "fpr1.github-91" },
    { kind: "ask" },
  );
  expect(view.queryByTestId("canonical-conversation")).toBeNull();
  expect(mockPrepareThreadLink).toHaveBeenCalledWith("server:linked-thread");
  expect(order).toEqual(["prepare", "replace"]);
  expect(mockSelectThread).not.toHaveBeenCalled();
});

it("keeps the review chat beside the PR on a desktop narrower than three panes", async () => {
  // An unfolded Fold is a desktop layout well below the three-pane width.
  mockDesktop = true;
  mockViewportWidth = 900;
  const pending = Promise.withResolvers<{
    readonly created: boolean;
    readonly kind: "ready";
    readonly threadId: string;
  }>();
  mockEnsureReviewChat.mockImplementation(() => pending.promise);
  const view = render(<PullRequestRoute tab="overview" />);

  fireEvent.press(view.getByTestId("open-review-chat", { includeHiddenElements: true }));
  await act(async () => {
    pending.resolve({ created: false, kind: "ready", threadId: "linked-thread" });
    await pending.promise;
  });

  await waitFor(() => {
    expect(view.getByTestId("canonical-conversation")).toHaveTextContent("linked-thread");
  });
  expect(view.getByTestId("pull-request-chat-pane")).toBeVisible();
  expect(mockSetDetailExpanded).toHaveBeenLastCalledWith(true);
  expect(mockReplaceWithLinkedThread).not.toHaveBeenCalled();
  expect(mockPrepareThreadLink).not.toHaveBeenCalled();
});

it("ignores a late suggestion result after the user closes the draft", async () => {
  mockDesktop = false;
  const pending = Promise.withResolvers<{
    readonly created: boolean;
    readonly kind: "ready";
    readonly threadId: string;
  }>();
  mockEnsureReviewChat.mockImplementation(() => pending.promise);
  const view = render(<PullRequestRoute tab="overview" />);

  fireEvent.press(view.getByTestId("open-review-chat"));
  fireEvent.press(view.getByLabelText("Close review chat"));
  await act(async () => {
    pending.resolve({ created: false, kind: "ready", threadId: "cancelled-thread" });
    await pending.promise;
  });

  expect(view.queryByTestId("pull-request-chat-draft")).toBeNull();
  expect(mockPrepareThreadLink).not.toHaveBeenCalled();
  expect(mockReplaceWithLinkedThread).not.toHaveBeenCalled();
});

it("accepts only the latest concurrent review-chat attempt", async () => {
  mockDesktop = false;
  const first = Promise.withResolvers<{
    readonly created: boolean;
    readonly kind: "ready";
    readonly threadId: string;
  }>();
  const second = Promise.withResolvers<{
    readonly created: boolean;
    readonly kind: "ready";
    readonly threadId: string;
  }>();
  mockEnsureReviewChat.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const view = render(<PullRequestRoute tab="overview" />);

  fireEvent.press(view.getByTestId("open-review-chat"));
  fireEvent.press(view.getByLabelText("Close review chat"));
  fireEvent.press(view.getByTestId("open-review-chat"));
  await act(async () => {
    second.resolve({ created: false, kind: "ready", threadId: "latest-thread" });
    await second.promise;
  });
  await waitFor(() => {
    expect(mockReplaceWithLinkedThread).toHaveBeenCalledWith("server", "latest-thread");
  });
  await act(async () => {
    first.resolve({ created: false, kind: "ready", threadId: "stale-thread" });
    await first.promise;
  });

  expect(mockPrepareThreadLink).toHaveBeenCalledTimes(1);
  expect(mockPrepareThreadLink).toHaveBeenCalledWith("server:latest-thread");
  expect(mockReplaceWithLinkedThread).toHaveBeenCalledTimes(1);
  expect(mockReplaceWithLinkedThread).toHaveBeenCalledWith("server", "latest-thread");
});

it("invalidates pending review chat work when the PR identity changes", async () => {
  mockDesktop = false;
  const pending = Promise.withResolvers<{
    readonly created: boolean;
    readonly kind: "ready";
    readonly threadId: string;
  }>();
  mockEnsureReviewChat.mockImplementation(() => pending.promise);
  const view = render(<PullRequestRoute tab="overview" />);
  fireEvent.press(view.getByTestId("open-review-chat"));

  mockParams = { connectionId: "other", pullRequestKey: "fpr1.github-92" };
  view.rerender(<PullRequestRoute tab="overview" />);
  await act(async () => {
    pending.resolve({ created: false, kind: "ready", threadId: "stale-thread" });
    await pending.promise;
  });

  expect(mockPrepareThreadLink).not.toHaveBeenCalled();
  expect(mockReplaceWithLinkedThread).not.toHaveBeenCalled();
});

it("invalidates pending review chat work on unmount", async () => {
  const pending = Promise.withResolvers<{
    readonly created: boolean;
    readonly kind: "ready";
    readonly threadId: string;
  }>();
  mockEnsureReviewChat.mockImplementation(() => pending.promise);
  const view = render(<PullRequestRoute tab="overview" />);
  fireEvent.press(view.getByTestId("open-review-chat"));
  view.unmount();

  await act(async () => {
    pending.resolve({ created: false, kind: "ready", threadId: "late-thread" });
    await pending.promise;
  });

  expect(mockReplaceWithLinkedThread).not.toHaveBeenCalled();
});

it("keeps the draft usable without suggestions when the request fails", async () => {
  mockDesktop = false;
  mockViewportWidth = 400;
  const pending = Promise.withResolvers<{
    readonly created: boolean;
    readonly kind: "ready";
    readonly threadId: string;
  }>();
  mockEnsureReviewChat.mockImplementation(() => pending.promise);
  const view = render(<PullRequestRoute tab="overview" />);
  fireEvent.press(view.getByTestId("open-review-chat"));

  await act(async () => {
    pending.reject(new Error("ensure failed"));
    await pending.promise.catch(() => undefined);
  });

  expect(view.getByTestId("pull-request-chat-draft")).toBeVisible();
  expect(getAppDialogRequest()).toBeNull();
});

it("closes every PR tab to the canonical pull-request catalog route", () => {
  const view = render(<PullRequestRoute tab="changes" />);

  fireEvent.press(view.getByTestId("close-pull-request"));

  expect(mockDismissTo).toHaveBeenCalledWith("/pulls");
});

it("pushes Changes over Details and steps back to it", () => {
  const details = render(<PullRequestRoute tab="overview" />);
  fireEvent.press(details.getByTestId("open-changes"));
  expect(mockPush).toHaveBeenLastCalledWith({
    params: { connectionId: "server", pullRequestKey: "fpr1.github-91", view: "files" },
    pathname: "/pulls/[connectionId]/[pullRequestKey]/changes",
  });
  fireEvent.press(details.getByTestId("open-guide"));
  expect(mockPush).toHaveBeenLastCalledWith({
    params: { connectionId: "server", pullRequestKey: "fpr1.github-91", view: "guide" },
    pathname: "/pulls/[connectionId]/[pullRequestKey]/changes",
  });
  details.unmount();

  const changes = render(<PullRequestRoute tab="changes" />);
  fireEvent.press(changes.getByTestId("open-details"));
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockReplace).not.toHaveBeenCalled();
});

it("replaces a deep-linked Changes with Details when there is nothing to go back to", () => {
  mockCanGoBack = false;
  const changes = render(<PullRequestRoute tab="changes" />);
  fireEvent.press(changes.getByTestId("open-details"));
  expect(mockBack).not.toHaveBeenCalled();
  expect(mockReplace).toHaveBeenLastCalledWith({
    params: { connectionId: "server", pullRequestKey: "fpr1.github-91" },
    pathname: "/pulls/[connectionId]/[pullRequestKey]",
  });
});

it("opens a chat the overview names beside the PR without asking the Companion", () => {
  const view = render(<PullRequestRoute tab="overview" />);

  fireEvent.press(view.getByTestId("open-existing-review-chat"));

  expect(view.getByTestId("canonical-conversation")).toHaveTextContent("existing-thread");
  expect(mockEnsureReviewChat).not.toHaveBeenCalled();
});
