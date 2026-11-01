import { act, fireEvent, testRouter, waitFor, within } from "expo-router/testing-library";
import { router } from "expo-router/build/imperative-api";

import { desktopThreadSidebarWidth } from "../src/presentation/layouts/windowLayout";
import { linkedThreadSelectionKey } from "../src/routeComposition/pullRequestNavigation";
import { renderProductionPullRequestRouter } from "./fixtures/PullRequestProductionRouter";
import { productionReviewThread } from "./fixtures/PullRequestProductionScreens";
import { getAppDialogRequest, resetAppDialog } from "./mocks/AppDialog";

const mockEnsureReviewChat = jest.fn();
const mockPrepareThreadLink = jest.fn();
const mockWorkspaceListeners = new Set<() => void>();
let mockDesktop = false;
let mockOrder: string[] = [];
let mockNavigateError: Error | null = null;
let mockViewportWidth = 400;

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
    useRouter: () => {
      const router = hooks.useRouter();
      return {
        ...router,
        navigate: (...args: Parameters<typeof router.navigate>) => {
          mockOrder.push("navigate");
          const error = mockNavigateError;
          mockNavigateError = null;
          if (error !== null) {
            throw error;
          }
          router.navigate(...args);
        },
      };
    },
  };
});
jest.mock("expo-symbols", () => ({}));
jest.mock("../src/data/forgeRuntime", () => ({
  forgeResources: {},
  pullRequestCommentDestinations: {},
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
jest.mock("../src/routeComposition/PullRequestConversationPane", () => ({
  PullRequestConversationPane: jest.requireActual("./fixtures/PullRequestProductionScreens")
    .ProductionPullRequestConversation,
}));
jest.mock("../src/routeComposition/PullRequestReviewChatDraftPane", () => ({
  PullRequestReviewChatDraftPane: jest.requireActual("./fixtures/PullRequestProductionScreens")
    .ProductionPullRequestDraft,
}));
jest.mock("../src/routeComposition/PullRequestsCatalogRoute", () => ({
  PullRequestsPreviewRoute: () => null,
}));
jest.mock("../src/rendering/reduced-motion-store", () => ({
  useReducedMotionPreference: () => true,
}));
jest.mock("../src/services/workspace/workspaceRouteResources", () => ({
  useWorkspaceRouteResources: () => {
    const { useSyncExternalStore } = jest.requireActual("react");
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
        prepareThreadLink: (selectionKey: string) => {
          mockOrder.push("prepare");
          mockPrepareThreadLink(selectionKey);
        },
      },
      runtime: { ready: false },
      viewportWidth: mockViewportWidth,
    };
  },
}));
jest.mock("../src/ui/AppFullscreenOverlay", () => ({
  useAppFullscreenOverlay: () => ({ present: jest.fn() }),
}));

function resizeWorkspace(desktop: boolean, viewportWidth: number): void {
  act(() => {
    mockDesktop = desktop;
    mockViewportWidth = viewportWidth;
    mockWorkspaceListeners.forEach((listener) => listener());
  });
}

function accessibleActionLabels(
  view: ReturnType<typeof renderProductionPullRequestRouter>,
): string[] {
  return [...view.queryAllByRole("button"), ...view.queryAllByRole("tab")]
    .map((action) =>
      typeof action.props.accessibilityLabel === "string" ? action.props.accessibilityLabel : "",
    )
    .filter((label) => label.length > 0)
    .toSorted();
}

function expectCompactReviewChatAvailable(
  view: ReturnType<typeof renderProductionPullRequestRouter>,
  label = "Start linked review chat",
): void {
  expectCatalogModeBarHidden(view);
  expect(accessibleActionLabels(view)).toEqual([label]);
}

function expectCatalogModeBarHidden(
  view: ReturnType<typeof renderProductionPullRequestRouter>,
): void {
  expect(view.queryByTestId("floating-catalog-mode-bar")).toBeNull();
  expect(
    view.getByTestId("floating-catalog-mode-bar", { includeHiddenElements: true }),
  ).not.toBeVisible();
}

beforeEach(() => {
  mockDesktop = false;
  productionReviewThread.current = null;
  mockEnsureReviewChat.mockReset();
  mockPrepareThreadLink.mockClear();
  mockNavigateError = null;
  mockOrder = [];
  mockViewportWidth = 400;
  mockWorkspaceListeners.clear();
  resetAppDialog();
});
it("opens the overview's review chat through preparation and canonical tab navigation", async () => {
  productionReviewThread.current = { threadId: "resolved-thread", title: "Linked thread" };
  const view = renderProductionPullRequestRouter();
  fireEvent.press(view.getByTestId("pull-request-linked-chat"));
  await waitFor(() => {
    expect(view.getPathname()).toBe("/threads/server/resolved-thread");
  });
  expect(mockOrder).toEqual(["prepare", "navigate"]);
  expect(mockEnsureReviewChat).not.toHaveBeenCalled();
  expect(mockPrepareThreadLink).toHaveBeenCalledWith(
    linkedThreadSelectionKey("server", "resolved-thread"),
  );
  expect(view.getByTestId("production-canonical-thread")).toHaveTextContent(
    "server:resolved-thread",
  );
  expect(
    view.queryByTestId("pull-request-workspace", { includeHiddenElements: true }),
  ).not.toBeNull();

  testRouter.back();
  expect(view.getPathname()).toBe("/");
  expect(view.getByTestId("production-threads-catalog")).toBeVisible();
});

it("opens the draft at once and navigates to a live chat the suggestion request finds", async () => {
  const pending = Promise.withResolvers<{
    readonly created: boolean;
    readonly kind: "ready";
    readonly threadId: string;
  }>();
  mockEnsureReviewChat.mockImplementation(() => {
    mockOrder.push("ensure");
    return pending.promise;
  });
  const view = renderProductionPullRequestRouter();
  fireEvent.press(view.getByTestId("pull-request-linked-chat"));
  expect(view.getByTestId("production-review-chat-draft")).toBeVisible();

  await act(async () => {
    pending.resolve({ created: false, kind: "ready", threadId: "linked-thread" });
    await pending.promise;
  });
  await waitFor(() => {
    expect(view.getPathname()).toBe("/threads/server/linked-thread");
  });
  expect(mockOrder).toEqual(["ensure", "prepare", "navigate"]);
});

it.each(["prepare", "navigate"] as const)(
  "restores the PR and reports a production %s failure",
  async (stage) => {
    productionReviewThread.current = { threadId: "retry-thread", title: "Linked thread" };
    const error = new Error(`${stage} failed`);
    if (stage === "prepare") {
      mockPrepareThreadLink.mockImplementationOnce(() => {
        throw error;
      });
    } else {
      mockNavigateError = error;
    }
    const view = renderProductionPullRequestRouter();
    fireEvent.press(view.getByTestId("pull-request-linked-chat"));

    await waitFor(() => {
      expect(getAppDialogRequest()).toMatchObject({
        message: `${stage} failed`,
        title: "Could not open the review chat",
      });
    });
    expect(view.getPathname()).toBe("/pulls/server/fpr1.github-91");
    expectCompactReviewChatAvailable(view, "Open linked review chat: Linked thread");

    fireEvent.press(view.getByTestId("pull-request-linked-chat"));
    await waitFor(() => {
      expect(view.getPathname()).toBe("/threads/server/retry-thread");
    });
    expect(mockEnsureReviewChat).not.toHaveBeenCalled();
  },
);

it("isolates the production catalog and PR actions while the compact draft is open", async () => {
  const pending = Promise.withResolvers<{
    readonly created: boolean;
    readonly kind: "ready";
    readonly threadId: string;
  }>();
  mockEnsureReviewChat.mockImplementation(() => pending.promise);
  const view = renderProductionPullRequestRouter();
  expectCompactReviewChatAvailable(view);
  fireEvent.press(view.getByTestId("pull-request-linked-chat"));

  expectCatalogModeBarHidden(view);
  expect(accessibleActionLabels(view)).toEqual(["Close review chat"]);
  fireEvent.press(view.getByLabelText("Close review chat"));
  expectCompactReviewChatAvailable(view);

  await act(async () => {
    pending.resolve({ created: false, kind: "ready", threadId: "late-thread" });
    await pending.promise;
  });

  expect(view.getPathname()).toBe("/pulls/server/fpr1.github-91");
  expect(view.getByTestId("production-pr-overview")).toBeVisible();
  expect(mockPrepareThreadLink).not.toHaveBeenCalled();
});

it.each([
  ["PR B", "/pulls/server/fpr1.github-92", "resolve"],
  ["PR B", "/pulls/server/fpr1.github-92", "reject"],
  ["Threads", "/", "resolve"],
  ["Threads", "/", "reject"],
] as const)(
  "keeps PR A's draft and never navigates for a result settled while %s is shown (%s)",
  async (_label, destination, outcome) => {
    const pending = Promise.withResolvers<{
      readonly created: boolean;
      readonly kind: "ready";
      readonly threadId: string;
    }>();
    mockEnsureReviewChat.mockImplementationOnce(() => {
      mockOrder.push("ensure");
      return pending.promise;
    });
    const view = renderProductionPullRequestRouter();
    fireEvent.press(view.getByTestId("pull-request-linked-chat"));

    act(() => router.navigate(destination));
    expect(view.getPathname()).toBe(destination);
    await act(async () => {
      if (outcome === "resolve")
        pending.resolve({ created: false, kind: "ready", threadId: "stale-thread" });
      else pending.reject(new Error("stale failure"));
      await pending.promise.catch(() => undefined);
    });
    testRouter.back();
    expect(view.getPathname()).toBe("/pulls/server/fpr1.github-91");
    expect(mockOrder).toEqual(["ensure"]);
    expect(mockPrepareThreadLink).not.toHaveBeenCalled();
    expect(getAppDialogRequest()).toBeNull();
    expect(view.getByTestId("production-review-chat-draft")).toBeVisible();
  },
);

it("shows the bar only on PR catalog roots while retaining the exact detail", () => {
  const view = renderProductionPullRequestRouter("/pulls");
  expect(view.getByTestId("floating-catalog-mode-bar")).toBeVisible();
  expect(
    within(view.getByTestId("workspace-catalog-pane")).getByTestId("floating-catalog-mode-bar"),
  ).toBeVisible();
  act(() => router.push("/pulls/server/fpr1.github-91"));
  const detail = view.getByTestId("pull-request-workspace");
  expectCatalogModeBarHidden(view);
  act(() => router.navigate("/"));
  expect(view.getByTestId("production-threads-catalog")).toBeVisible();
  fireEvent(view.getByRole("tab", { name: "Pull requests" }), "accessibilityAction", {
    nativeEvent: { actionName: "activate" },
  });
  expect(view.getPathname()).toBe("/pulls/server/fpr1.github-91");
  expect(view.getByTestId("pull-request-workspace")).toBe(detail);
  expectCompactReviewChatAvailable(view);
  testRouter.back();
  expect(view.getPathname()).toBe("/pulls");
  expect(view.getByTestId("floating-catalog-mode-bar")).toBeVisible();
  act(() => router.push("/pulls/server/fpr1.github-91/changes"));
  expect(view.getPathname()).toBe("/pulls/server/fpr1.github-91/changes");
  expectCatalogModeBarHidden(view);
});

it("keys compact claims to the active route across resize, Back, close and restoration", async () => {
  mockDesktop = true;
  mockViewportWidth = 1200;
  mockEnsureReviewChat
    .mockResolvedValueOnce({ created: false, kind: "ready", threadId: "first-thread" })
    .mockResolvedValueOnce({ created: false, kind: "ready", threadId: "second-thread" });
  const view = renderProductionPullRequestRouter();

  fireEvent.press(view.getByTestId("pull-request-linked-chat"));
  await waitFor(() => {
    expect(view.getByText("first-thread")).toBeVisible();
  });
  resizeWorkspace(true, 1000);
  expectCatalogModeBarHidden(view);
  // The chat's destination covers the catalog, which dims beneath it.
  expect(view.getByTestId("workspace-catalog-pane", { includeHiddenElements: true })).toHaveStyle({
    opacity: 0,
  });

  act(() => router.push("/pulls/server/fpr1.github-92"));
  expect(view.getByTestId("floating-catalog-mode-bar")).toBeVisible();
  expect(view.getByTestId("workspace-catalog-pane")).toHaveStyle({
    width: desktopThreadSidebarWidth(1000),
  });

  resizeWorkspace(true, 1200);
  fireEvent.press(view.getByTestId("pull-request-linked-chat"));
  await waitFor(() => {
    expect(view.getByText("second-thread")).toBeVisible();
  });
  resizeWorkspace(true, 1000);
  expectCatalogModeBarHidden(view);
  testRouter.back();
  expect(view.getPathname()).toBe("/pulls/server/fpr1.github-91");
  expect(view.getByText("first-thread")).toBeVisible();
  expectCatalogModeBarHidden(view);
  fireEvent.press(view.getByLabelText("Close review chat"));
  // Closing the chat beside the PR is a pane rearrangement: it applies on the next frame, after
  // the pane transition is armed.
  await waitFor(() => {
    expect(view.getByTestId("floating-catalog-mode-bar")).toBeVisible();
  });
  expect(accessibleActionLabels(view)).toEqual([
    "Pull requests",
    "Start linked review chat",
    "Threads",
  ]);
  expect(view.getByTestId("workspace-catalog-pane")).toHaveStyle({
    width: desktopThreadSidebarWidth(1000),
  });
});
