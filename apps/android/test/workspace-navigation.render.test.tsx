import * as summaryView from "../src/data/use-thread-summary-view";
import { summary } from "./fixtures/thread-summary";
import { MobileThreads } from "../src/features/threadList/MobileThreads";
import { ThreadSidebar } from "../src/features/threadList/ThreadSidebar";
import { useSelector } from "@legendapp/state/react";
import { useIsFocused } from "expo-router";
import {
  act,
  fireEvent,
  fireEventAsync,
  render,
  renderAsync,
  renderHook,
  waitFor,
  within,
} from "@testing-library/react-native";
import { useState } from "react";
import { ThreadRow } from "../src/features/threadList/ThreadRow";
import { GlobalSearchScreen } from "../src/features/search/GlobalSearchScreen";
import { KeyboardController } from "react-native-keyboard-controller";
import { useEvent } from "../src/react/useEvent";
import {
  Animated,
  BackHandler,
  Dimensions,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
} from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { LegendList } from "@legendapp/list/react-native";
import { GestureDetector } from "react-native-gesture-handler";

import { WorkspaceRouteComposition } from "../src/routeComposition/WorkspaceRouteComposition";
import { MountedV1Workspace } from "../app/(workspace)/_layout";
import V1DrawingRoute from "../app/(workspace)/drawing/[sessionId]";
import UnmatchedRoute from "../app/+not-found";
import V1ListLayout from "../app/(workspace)/(lists)/_layout";
import V1AllRoute from "../app/(workspace)/(lists)/index";
import V1SearchRoute from "../app/(workspace)/search";
import V1ProjectListRoute from "../app/(workspace)/(lists)/project/[sessionId]";
import { projectListRouteSessions } from "../src/services/projects/projectListRouteSession";
import { useWorkspaceListRouteResources } from "../src/routeComposition/workspaceListRouteResources";
import V1DraftContentRoute from "../app/(workspace)/new/content/[sessionId]";
import V1DraftModelRoute from "../app/(workspace)/new/controls/model";
import V1AgentThreadRoute from "../app/(workspace)/threads/[connectionId]/[threadId]/agents/[agentThreadId]";
import V1ThreadLayout from "../app/(workspace)/threads/[connectionId]/[threadId]/_layout";
import V1ThreadRoute from "../app/(workspace)/threads/[connectionId]/[threadId]/index";
import { useThreadRouteNavigation } from "../src/routeComposition/threadRouteNavigation";
import {
  ensureV1NewThreadRoute,
  useWorkspaceRouteModel,
} from "../src/routeComposition/WorkspaceRouteModel";
import { recoverUnavailableRoute } from "../src/components/navigation/routeRecovery";
import { workspaceRuntime } from "../src/data/workspace-runtime";
import { useConversationRouteNavigation } from "../src/features/conversation/conversationRouteNavigation";
import { createNewChatSubmission } from "../src/features/projects/newChatSubmission";
import { radii } from "../src/theme";
import {
  AppFullscreenOverlayHost,
  AppFullscreenOverlayProvider,
} from "../src/ui/AppFullscreenOverlay";
import { AppNoticeContext } from "../src/ui/appNoticeContext";
import { agentRouteSessions } from "../src/services/agents/agentRouteSession";
import { drawingRouteSessions } from "../src/services/drawing/drawingRouteSession";
import { disposeAllRouteSessions, ROUTE_SESSION_TTL_MS } from "../src/services/routeSessionPolicy";
import { searchRouteSessions } from "../src/services/search/searchRouteSession";
import { NewThreadService, newThreadService } from "../src/services/threads/newThreadService";
import {
  useThreadNavigationService,
  type ThreadNavigationReadCapability,
} from "../src/services/threads/threadNavigationService";
import {
  threadSelectionKey,
  threadRouteSessionOwner,
  v1ThreadRouteParams,
  workspaceRouteSessionOwner,
} from "../src/services/threads/threadRouteParams";
import { useRouteSessionLifetime } from "../src/services/useRouteSessionLifetime";
import { useWorkspaceRouteResources } from "../src/services/workspace/workspaceRouteResources";
import { workspaceFeatures } from "../src/features/workspace/createWorkspaceFeatures";
import {
  clearMockRoutes,
  mockRouterHistory,
  registerMockRoute,
  registerMockLayout,
  resetMockRouter,
  router,
  setMockLocalSearchParams,
} from "./mocks/ExpoRouter";

const remote: ThreadNavigationReadCapability = {
  observeThread: async () => undefined,
  searchConversation: async () => ({ messages: [], newer: null, older: null, turns: [] }),
};

const testNotice = { show: jest.fn() };

function useMountedThreadNavigation(readCapability: ThreadNavigationReadCapability = remote) {
  const route = useWorkspaceRouteModel();
  const navigation = useThreadNavigationService(readCapability, route.threadRouter);
  return { navigation, route };
}

const threadSearchTarget = {
  connectionId: "server",
  hit: {
    excerpt: "",
    kind: "thread" as const,
    messageId: 0,
    project: "",
    sourceOffset: 0,
    threadId: "search-result",
    timestamp: "2026-09-17T00:00:00.000Z",
    title: "Search result",
    turnId: "",
  },
};

beforeEach(() => {
  jest.mocked(useIsFocused).mockReturnValue(true);
  registerMockLayout("lists", ["/", "/project/[sessionId]"], V1ListLayout);
  registerMockRoute("/", V1AllRoute);
  registerMockRoute("/search", V1SearchRoute);
  registerMockRoute("/project/[sessionId]", V1ProjectListRoute);
});

afterEach(() => {
  testNotice.show.mockClear();
  clearMockRoutes();
  disposeAllRouteSessions();
  newThreadService.dispose();
  resetMockRouter();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

function V1RouteTree({ layout = false }: { readonly layout?: boolean }): React.JSX.Element {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 800, width: 400, x: 0, y: 0 },
        insets: { bottom: 0, left: 0, right: 0, top: 0 },
      }}
    >
      <AppNoticeContext.Provider value={testNotice}>
        <AppFullscreenOverlayProvider>
          {layout ? <MountedV1Workspace /> : <WorkspaceRouteComposition />}
          <AppFullscreenOverlayHost />
        </AppFullscreenOverlayProvider>
      </AppNoticeContext.Provider>
    </SafeAreaProvider>
  );
}

function holdInitialDeepLink(): void {
  jest.spyOn(Linking, "getInitialURL").mockReturnValue(new Promise(() => undefined));
}

function setWindowSize(width: number, height: number): void {
  act(() => {
    Dimensions.set({
      screen: { fontScale: 1, height, scale: 1, width },
      window: { fontScale: 1, height, scale: 1, width },
    });
  });
}

function registerV1NavigationRoutes(): void {
  registerMockRoute("/", V1AllRoute);
  registerMockRoute("/drawing/[sessionId]", V1DrawingRoute);
  registerMockRoute("/threads/[connectionId]/[threadId]", V1ThreadRoute);
}

it("presents an asynchronous Global Voice failure through the application notice", async () => {
  holdInitialDeepLink();
  const previous = workspaceFeatures.globalSupervisor.render$.peek();
  act(() => {
    workspaceFeatures.globalSupervisor.render$.set({
      activity: null,
      failureSummary: "The live voice session ended unexpectedly.",
      home: null,
      phase: "failed",
      recovery: { action: "retryCapabilityProbe", label: "Retry voice check" },
      target: null,
      transcript: [],
    });
  });
  let view: ReturnType<typeof render> | null = null;
  try {
    view = render(<V1RouteTree />);
    await waitFor(() =>
      expect(testNotice.show).toHaveBeenCalledWith({
        duration: 3000,
        label: "The live voice session ended unexpectedly.",
        variant: "error",
      }),
    );
  } finally {
    view?.unmount();
    act(() => {
      workspaceFeatures.globalSupervisor.render$.set(previous);
    });
  }
});

function DraftView({ service }: { service: NewThreadService }): React.JSX.Element {
  const draft = useSelector(() => service.draft$.get());
  return <Text>{draft === null ? "Threads" : `draft:${draft.id}:${draft.cwd ?? "none"}`}</Text>;
}

function BrowserLauncher(): React.JSX.Element {
  const resources = useWorkspaceRouteResources();
  return (
    <Text
      onPress={() => {
        resources.openBrowser("Attachment", "https://example.com/attachment");
      }}
    >
      Open browser attachment
    </Text>
  );
}

function AttachmentLauncher(): React.JSX.Element {
  const navigation = useConversationRouteNavigation();
  return <Text onPress={navigation.openAttachments}>Open attachments</Text>;
}

it("opens thread children for the current URL when the retained layout has stale local params", () => {
  try {
    const pathname = "/threads/[connectionId]/[threadId]";
    registerMockRoute(pathname, AttachmentLauncher);
    resetMockRouter({
      params: { connectionId: "server", threadId: "current" },
      pathname,
    });
    setMockLocalSearchParams({ connectionId: "server", threadId: "first" });

    const view = render(<V1ThreadLayout />);
    fireEvent.press(view.getByText("Open attachments"));

    expect(mockRouterHistory().at(-1)).toEqual({
      params: {
        connectionId: "server",
        sessionId: expect.stringMatching(/^attachments-/u),
        threadId: "current",
      },
      pathname: "/threads/[connectionId]/[threadId]/attachments",
    });
    view.unmount();
  } finally {
  }
});

it("retains the route-owned draft across view remounts and closes it explicitly", () => {
  const service = new NewThreadService();
  const view = render(<DraftView service={service} />);
  expect(view.getByText("Threads")).toBeTruthy();
  let draftId = "";
  act(() => {
    draftId = service.open("server", null).id;
  });
  expect(view.getByText(`draft:${draftId}:none`)).toBeTruthy();
  view.unmount();
  const remounted = render(<DraftView service={service} />);
  expect(remounted.getByText(`draft:${draftId}:none`)).toBeTruthy();
  act(() => service.close(draftId));
  expect(remounted.getByText("Threads")).toBeTruthy();
});

it("mounts the real V1 workspace route composition", async () => {
  resetMockRouter("/");
  const initialUrl = Promise.withResolvers<string | null>();
  jest.spyOn(Linking, "getInitialURL").mockReturnValue(initialUrl.promise);
  const view = render(<V1RouteTree />);
  await act(async () => {
    initialUrl.resolve(null);
    await initialUrl.promise;
  });
  expect(view.toJSON()).not.toBeNull();
  view.unmount();
});

it("shows a chat-selection placeholder in an empty desktop destination", () => {
  holdInitialDeepLink();
  registerV1NavigationRoutes();
  resetMockRouter("/");
  const view = render(<V1RouteTree />);
  setWindowSize(1_400, 800);

  expect(view.getByTestId("conversation-selection-placeholder")).toBeVisible();
  expect(view.getByText("Select a chat")).toBeVisible();
  expect(view.getByText("Choose a conversation from the list to open it here.")).toBeVisible();

  setWindowSize(400, 800);
  view.unmount();
});

it("clips the desktop chat destination to its rounded left boundary", () => {
  holdInitialDeepLink();
  registerV1NavigationRoutes();
  resetMockRouter("/");
  const view = render(<V1RouteTree />);
  setWindowSize(1_400, 800);

  expect(StyleSheet.flatten(view.getByTestId("v1-workspace-destination").props.style)).toEqual(
    expect.objectContaining({
      borderBottomLeftRadius: radii.composer,
      borderTopLeftRadius: radii.composer,
      overflow: "hidden",
    }),
  );

  setWindowSize(400, 800);
  expect(
    StyleSheet.flatten(
      view.getByTestId("v1-workspace-destination", { includeHiddenElements: true }).props.style,
    ),
  ).not.toEqual(
    expect.objectContaining({
      borderBottomLeftRadius: radii.composer,
      borderTopLeftRadius: radii.composer,
    }),
  );
  view.unmount();
});

it("keeps the selected route mounted while phone rotation opens the two-pane workspace", () => {
  holdInitialDeepLink();
  registerV1NavigationRoutes();
  resetMockRouter("/");
  setWindowSize(400, 800);
  const view = render(<V1RouteTree />);
  const { result } = renderHook(useMountedThreadNavigation);
  act(() => {
    result.current.navigation.selectThread(
      threadSelectionKey({ id: "selected", serverId: "server" }),
    );
  });
  const destination = view.getByTestId("v1-workspace-destination");

  expect(view.queryByText("Threads")).toBeNull();
  expect(view.getByText("Server unavailable")).toBeVisible();

  setWindowSize(800, 360);

  expect(view.getByText("Threads")).toBeVisible();
  expect(view.getByText("Server unavailable")).toBeVisible();
  expect(view.getByTestId("v1-workspace-destination")).toBe(destination);
  expect(mockRouterHistory().at(-1)?.pathname).toBe("/threads/[connectionId]/[threadId]");

  setWindowSize(400, 800);

  expect(view.queryByText("Threads")).toBeNull();
  expect(view.getByText("Server unavailable")).toBeVisible();
  expect(view.getByTestId("v1-workspace-destination")).toBe(destination);
  view.unmount();
});

it("shows a retained live Search beside its result chat after rotation", () => {
  holdInitialDeepLink();
  registerV1NavigationRoutes();
  setWindowSize(400, 800);
  const session = searchRouteSessions.open(workspaceRouteSessionOwner);
  resetMockRouter({
    params: {
      connectionId: "server",
      globalSearchSessionId: session.id,
      threadId: "result",
    },
    pathname: "/threads/[connectionId]/[threadId]",
  });
  const view = render(<V1RouteTree />);

  expect(view.queryByTestId("sidebar-search")).toBeNull();
  setWindowSize(800, 360);

  expect(view.getByTestId("sidebar-search")).toBeVisible();
  expect(view.UNSAFE_getByType(GlobalSearchScreen).props.session).toBe(session.session);
  expect(mockRouterHistory().at(-1)?.params.globalSearchSessionId).toBe(session.id);

  setWindowSize(400, 800);
  view.unmount();
});

it("preserves mobile Search through result navigation, rotation, and Back", () => {
  holdInitialDeepLink();
  registerV1NavigationRoutes();
  setWindowSize(400, 800);
  resetMockRouter("/");
  const view = render(<V1RouteTree />);
  fireEvent.press(view.getByLabelText("Search threads and messages"));
  const sessionId = mockRouterHistory().at(-1)?.params.globalSearchSessionId;
  if (sessionId === undefined) {
    throw new Error("Expected Search session");
  }
  const session = searchRouteSessions.get(sessionId, workspaceRouteSessionOwner)?.session;
  if (session === undefined) {
    throw new Error("Expected live Search session");
  }
  act(() => {
    router.push({
      params: { connectionId: "server", globalSearchSessionId: sessionId, threadId: "result" },
      pathname: "/threads/[connectionId]/[threadId]",
    });
  });

  expect(view.queryByTestId("sidebar-search")).toBeNull();
  setWindowSize(800, 360);

  expect(view.getByTestId("sidebar-search")).toBeVisible();
  expect(view.UNSAFE_getByType(GlobalSearchScreen).props.session).toBe(session);

  setWindowSize(400, 800);
  act(() => router.back());
  expect(mockRouterHistory().at(-1)?.pathname).toBe("/search");
  expect(view.UNSAFE_getByType(GlobalSearchScreen).props.session).toBe(session);
  view.unmount();
});

it("does not restore explicitly closed Search from a stale result route on rotation", () => {
  holdInitialDeepLink();
  registerV1NavigationRoutes();
  setWindowSize(400, 800);
  resetMockRouter("/");
  const view = render(<V1RouteTree />);
  fireEvent.press(view.getByLabelText("Search threads and messages"));
  const sessionId = mockRouterHistory().at(-1)?.params.globalSearchSessionId;
  if (sessionId === undefined) {
    throw new Error("Expected Search session");
  }
  act(() => {
    router.push({
      params: { connectionId: "server", globalSearchSessionId: sessionId, threadId: "result" },
      pathname: "/threads/[connectionId]/[threadId]",
    });
    router.back();
  });
  expect(view.getByTestId("sidebar-search")).toBeVisible();
  fireEvent.press(view.getByLabelText("Back to threads"));
  expect(searchRouteSessions.get(sessionId, workspaceRouteSessionOwner)).toBeNull();
  view.unmount();

  resetMockRouter({
    params: { connectionId: "server", globalSearchSessionId: sessionId, threadId: "result" },
    pathname: "/threads/[connectionId]/[threadId]",
  });
  const restored = render(<V1RouteTree />);
  setWindowSize(800, 360);

  expect(restored.getByText("Threads")).toBeVisible();
  expect(restored.queryByTestId("sidebar-search")).toBeNull();
  expect(restored.queryByText("Search expired")).toBeNull();

  setWindowSize(400, 800);
  restored.unmount();
});

it("keeps desktop sidebar Search through a result and Back, then keeps its close through rotation", () => {
  holdInitialDeepLink();
  registerV1NavigationRoutes();
  setWindowSize(800, 360);
  resetMockRouter("/");
  act(() => {
    router.push({
      params: { connectionId: "server", threadId: "selected" },
      pathname: "/threads/[connectionId]/[threadId]",
    });
  });
  const view = render(<V1RouteTree />);
  fireEvent.press(view.getByLabelText("Search threads and messages"));
  const session = view.UNSAFE_getByType(GlobalSearchScreen).props.session;

  act(() => {
    view.UNSAFE_getByType(GlobalSearchScreen).props.onOpenThread(threadSearchTarget, "query");
  });
  expect(mockRouterHistory().at(-1)?.params.threadId).toBe("search-result");
  expect(view.UNSAFE_getByType(GlobalSearchScreen).props.session).toBe(session);

  act(() => router.back());
  expect(mockRouterHistory().at(-1)?.params.threadId).toBe("selected");
  expect(view.UNSAFE_getByType(GlobalSearchScreen).props.session).toBe(session);

  fireEvent.press(view.getByLabelText("Back to threads"));
  expect(searchRouteSessions.get(session.id, workspaceRouteSessionOwner)).toBeNull();
  setWindowSize(400, 800);
  setWindowSize(800, 360);
  expect(view.getByText("Threads")).toBeVisible();
  expect(view.queryByTestId("sidebar-search")).toBeNull();

  setWindowSize(400, 800);
  view.unmount();
});

it("restores desktop Search after it folds and its mobile result opens", () => {
  holdInitialDeepLink();
  registerV1NavigationRoutes();
  setWindowSize(1_400, 800);
  resetMockRouter("/");
  act(() => {
    router.push({
      params: { connectionId: "server", threadId: "selected" },
      pathname: "/threads/[connectionId]/[threadId]",
    });
  });
  const view = render(<V1RouteTree />);
  fireEvent.press(view.getByLabelText("Search threads and messages"));
  expect(view.getByTestId("sidebar-search")).toBeVisible();

  setWindowSize(400, 800);
  expect(mockRouterHistory().at(-1)?.pathname).toBe("/search");
  act(() => {
    view.UNSAFE_getByType(GlobalSearchScreen).props.onOpenThread(threadSearchTarget, "query");
  });
  expect(view.queryByTestId("sidebar-search")).toBeNull();

  setWindowSize(800, 360);
  expect(view.getByTestId("sidebar-search")).toBeVisible();

  setWindowSize(400, 800);
  view.unmount();
});

it("keeps an explicitly open mobile Search visible after rotation", () => {
  holdInitialDeepLink();
  setWindowSize(400, 800);
  resetMockRouter("/");
  const view = render(<V1RouteTree />);
  fireEvent.press(view.getByLabelText("Search threads and messages"));
  const session = view.UNSAFE_getByType(GlobalSearchScreen).props.session;

  setWindowSize(800, 360);

  expect(view.UNSAFE_getByType(GlobalSearchScreen).props.session).toBe(session);
  expect(view.getByTestId("sidebar-search")).toBeVisible();

  setWindowSize(400, 800);
  view.unmount();
});

it("does not restore mobile Search after system Back and rotation", () => {
  holdInitialDeepLink();
  setWindowSize(400, 800);
  resetMockRouter("/");
  const listeners: Array<() => boolean | null | undefined> = [];
  jest.spyOn(BackHandler, "addEventListener").mockImplementation((_event, listener) => {
    listeners.push(listener);
    return {
      remove: () => {
        const index = listeners.indexOf(listener);
        if (index !== -1) listeners.splice(index, 1);
      },
    };
  });
  const view = render(<V1RouteTree />);
  fireEvent.press(view.getByLabelText("Search threads and messages"));
  const sessionId = mockRouterHistory().at(-1)?.params.globalSearchSessionId;
  if (sessionId === undefined) {
    throw new Error("Expected Search session");
  }

  let handled = false;
  act(() => {
    for (let index = listeners.length - 1; index >= 0; index -= 1) {
      if (listeners[index]?.()) {
        handled = true;
        break;
      }
    }
  });
  expect(handled).toBe(true);
  expect(mockRouterHistory().at(-1)?.pathname).toBe("/");
  expect(searchRouteSessions.get(sessionId, workspaceRouteSessionOwner)).toBeNull();

  setWindowSize(800, 360);
  expect(view.getByText("Threads")).toBeVisible();
  expect(view.queryByTestId("sidebar-search")).toBeNull();

  setWindowSize(400, 800);
  view.unmount();
});

it("stretches the single-column workspace across compact phone landscape", () => {
  holdInitialDeepLink();
  registerV1NavigationRoutes();
  resetMockRouter("/");
  setWindowSize(700, 360);
  const view = render(<V1RouteTree />);
  const list = view.getByTestId("v1-workspace-destination");
  const listStyle = StyleSheet.flatten(list.props.style);

  expect(listStyle).toEqual(expect.objectContaining({ flex: 1 }));
  expect(listStyle).not.toHaveProperty("maxWidth");
  expect(view.getByText("Threads")).toBeVisible();

  const { result } = renderHook(useMountedThreadNavigation);
  act(() => {
    result.current.navigation.selectThread(
      threadSelectionKey({ id: "selected", serverId: "server" }),
    );
  });
  const destinationStyle = StyleSheet.flatten(
    view.getByTestId("v1-workspace-destination").props.style,
  );

  expect(destinationStyle).toEqual(expect.objectContaining({ flex: 1 }));
  expect(destinationStyle).not.toHaveProperty("maxWidth");
  expect(view.getByText("Server unavailable")).toBeVisible();

  setWindowSize(400, 800);
  view.unmount();
});

it("carries the selected thread into a browser attachment modal", () => {
  holdInitialDeepLink();
  const pathname = "/threads/[connectionId]/[threadId]";
  registerMockRoute(pathname, BrowserLauncher);
  resetMockRouter({
    params: { connectionId: "server", threadId: "selected" },
    pathname,
  });
  const view = render(<V1RouteTree />);

  fireEvent.press(view.getByText("Open browser attachment"));

  expect(mockRouterHistory().at(-1)).toEqual({
    params: {
      connectionId: "server",
      sessionId: expect.stringMatching(/^browser-/u),
      threadId: "selected",
    },
    pathname: "/browser/[sessionId]",
  });
  view.unmount();
});

it("replaces the mobile thread list with global search instead of the conversation pane", () => {
  holdInitialDeepLink();
  resetMockRouter("/");
  const view = render(<V1RouteTree />);

  fireEvent.press(view.getByLabelText("Search threads and messages"));

  expect(view.getByTestId("sidebar-search")).toBeTruthy();
  expect(mockRouterHistory().at(-1)?.pathname).toBe("/search");
  const searchSessionId = mockRouterHistory().at(-1)?.params.globalSearchSessionId;
  if (searchSessionId === undefined) {
    throw new Error("Expected global search session id");
  }
  act(() => {
    router.push({
      params: {
        connectionId: "server",
        globalSearchSessionId: searchSessionId,
        threadId: "result",
      },
      pathname: "/threads/[connectionId]/[threadId]",
    });
  });
  expect(searchRouteSessions.get(searchSessionId, workspaceRouteSessionOwner)).not.toBeNull();
  act(() => {
    router.back();
  });
  expect(view.getByTestId("sidebar-search")).toBeTruthy();
  view.unmount();
});

it.each([
  ["mobile", 400],
  ["desktop", 1_400],
] as const)("keeps %s search below the fixed Threads header", (_mode, width) => {
  holdInitialDeepLink();
  resetMockRouter("/");
  setWindowSize(width, 800);
  const view = render(<V1RouteTree />);
  const threadsHeader = view.getByTestId("thread-list-header-row");
  const threadsHeaderStyle = StyleSheet.flatten(threadsHeader.props.style);
  const orbSlot = view.getByTestId("global-voice-slot");

  expect(within(threadsHeader).getByText("Threads")).toBeTruthy();
  expect(within(threadsHeader).queryByLabelText("Search threads and messages")).toBeNull();
  expect(within(threadsHeader).getByLabelText(/Thread filters/u)).toBeTruthy();
  const searchRow = view.getByTestId("thread-search-row");
  expect(within(searchRow).getByLabelText("Search threads and messages")).toBeTruthy();

  fireEvent.press(within(searchRow).getByLabelText("Search threads and messages"));

  const searchHeader = view.getByTestId("global-search-header-row");
  expect(view.getByTestId("thread-search-row", { includeHiddenElements: true })).toBe(searchRow);
  expect(view.queryByTestId("global-voice-slot")).toBeNull();
  expect(
    within(searchHeader).queryByTestId("global-voice-orb", { includeHiddenElements: true }),
  ).toBeNull();
  expect(StyleSheet.flatten(searchHeader.props.style)).toEqual(threadsHeaderStyle);
  expect(view.getByTestId("search-overlay-panel")).toBeTruthy();
  expect(within(searchHeader).getByLabelText("Back to threads")).toBeTruthy();
  expect(within(searchHeader).getByLabelText("Search filters")).toBeTruthy();
  expect(
    within(view.getByTestId("search-top-input")).getByLabelText("Search filters"),
  ).toBeTruthy();

  fireEvent.press(within(searchHeader).getByLabelText("Back to threads"));
  expect(view.getByTestId("global-voice-slot")).toBe(orbSlot);
  expect(within(view.getByTestId("thread-list-header-row")).getByText("Threads")).toBeTruthy();
  setWindowSize(400, 800);
  view.unmount();
});

it.each([400, 1400])(
  "attaches the search pull gesture to the thread list scroll view at width %s",
  (width) => {
    holdInitialDeepLink();
    resetMockRouter("/");
    setWindowSize(width, 800);
    const view = render(<V1RouteTree />);
    const list = view.UNSAFE_getByType(LegendList);
    const scrollView = list.props.renderScrollComponent?.({});
    expect(scrollView?.type).toBe(GestureDetector);
    expect(scrollView?.props.children.type).toBe(Animated.ScrollView);
    const pullGesture = scrollView?.props.gesture.gestures[0];
    expect(pullGesture.config.testId).toBe("thread-list-pull-to-search");
    expect(pullGesture.config.activeOffsetYEnd).toBe(8);
    expect(pullGesture.config.failOffsetYStart).toBe(-8);
    expect(pullGesture.config.minDist).toBe(32);
    expect(typeof list.props.onScroll).toBe("function");
    expect(view.getByTestId("thread-list-pull-backdrop")).toBeTruthy();
    setWindowSize(400, 800);
    view.unmount();
  },
);

it.each([400, 1400])(
  "preserves the previous conversation when Search opens at width %s",
  (width) => {
    setWindowSize(width, 800);
    holdInitialDeepLink();
    registerV1NavigationRoutes();
    resetMockRouter("/");
    let openWorkspaceSearch = (): void => {
      throw new Error("Search capability unavailable");
    };
    function ConversationSearchProbe(): React.JSX.Element {
      openWorkspaceSearch = useWorkspaceListRouteResources().openGlobalSearch;
      return <Text>Selected conversation</Text>;
    }
    registerMockRoute("/threads/[connectionId]/[threadId]", ConversationSearchProbe);
    const view = render(<V1RouteTree />);
    const { result } = renderHook(useMountedThreadNavigation);
    act(() => {
      result.current.navigation.selectThread(
        threadSelectionKey({ id: "selected", serverId: "server" }),
      );
    });

    act(() => openWorkspaceSearch());

    expect(mockRouterHistory().map((entry) => entry.pathname)).toEqual(
      width === 1_400
        ? ["/", "/threads/[connectionId]/[threadId]"]
        : ["/", "/threads/[connectionId]/[threadId]", "/search"],
    );
    expect(mockRouterHistory().at(-1)?.params.threadId).toBe("selected");
    expect(view.getByTestId("sidebar-search")).toBeTruthy();
    if (width === 1_400) {
      expect(view.getByTestId("v1-workspace-destination").props.pointerEvents).toBe("auto");
    }

    let closeControl = view.getByLabelText("Back to threads");
    while (typeof closeControl.props.onPress !== "function") {
      const parent = closeControl.parent;
      if (parent === null) {
        throw new Error("Expected the mobile search close control to expose its press action");
      }
      closeControl = parent;
    }
    act(closeControl.props.onPress);

    expect(mockRouterHistory()).toEqual([
      { params: {}, pathname: "/" },
      {
        params: { connectionId: "server", threadId: "selected" },
        pathname: "/threads/[connectionId]/[threadId]",
      },
    ]);
    view.unmount();
  },
);

it("closes desktop search without reverting the chat selected from its results", () => {
  holdInitialDeepLink();
  resetMockRouter("/");
  const view = render(<V1RouteTree />);
  setWindowSize(1_400, 800);

  fireEvent.press(view.getByLabelText("Search threads and messages"));
  const searchSessionId = mockRouterHistory().at(-1)?.params.globalSearchSessionId;
  if (searchSessionId === undefined) {
    throw new Error("Expected global search session id");
  }
  act(() => {
    router.push({
      params: {
        connectionId: "server",
        globalSearchSessionId: searchSessionId,
        threadId: "result",
      },
      pathname: "/threads/[connectionId]/[threadId]",
    });
  });
  fireEvent.press(view.getByLabelText("Back to threads"));

  expect(mockRouterHistory().at(-1)).toEqual({
    params: { connectionId: "server", threadId: "result" },
    pathname: "/threads/[connectionId]/[threadId]",
  });
  setWindowSize(400, 800);
  view.unmount();
});

it("keeps the desktop chat route interactive while search opens and a result is selected", () => {
  holdInitialDeepLink();
  resetMockRouter("/");
  setWindowSize(1_400, 800);
  let openWorkspaceSearch = (): void => {
    throw new Error("Search capability unavailable");
  };
  let selectSearchResult = (): void => {
    throw new Error("Search result capability unavailable");
  };
  function ConversationSearchProbe(): React.JSX.Element {
    const resources = useWorkspaceListRouteResources();
    openWorkspaceSearch = resources.openGlobalSearch;
    selectSearchResult = () => resources.list.openSearchThread(threadSearchTarget, "query");
    return <Text>Selected conversation</Text>;
  }
  registerMockRoute("/threads/[connectionId]/[threadId]", ConversationSearchProbe);
  const view = render(<V1RouteTree />);
  const { result } = renderHook(useMountedThreadNavigation);
  act(() => {
    result.current.navigation.selectThread(
      threadSelectionKey({ id: "selected", serverId: "server" }),
    );
  });

  act(openWorkspaceSearch);
  const searchSessionId = mockRouterHistory().at(-1)?.params.globalSearchSessionId;
  expect(searchSessionId).toEqual(expect.any(String));
  expect(mockRouterHistory()).toHaveLength(2);
  expect(view.getByTestId("v1-workspace-destination").props.pointerEvents).toBe("auto");

  act(selectSearchResult);
  expect(mockRouterHistory().map((entry) => entry.pathname)).toEqual([
    "/",
    "/threads/[connectionId]/[threadId]",
    "/threads/[connectionId]/[threadId]",
  ]);
  expect(mockRouterHistory()[1]?.params.globalSearchSessionId).toBeUndefined();
  expect(mockRouterHistory().at(-1)?.params.globalSearchSessionId).toBe(searchSessionId);
  expect(searchRouteSessions.get(searchSessionId, workspaceRouteSessionOwner)).not.toBeNull();
  act(() => view.UNSAFE_getByType(GlobalSearchScreen).props.onClose());
  expect(mockRouterHistory().at(-1)?.params.globalSearchSessionId).toBeUndefined();
  expect(mockRouterHistory().at(-1)?.params.threadId).toBe("search-result");
  setWindowSize(400, 800);
  view.unmount();
});

it("retains desktop Search when result navigation commits route parameters separately", () => {
  holdInitialDeepLink();
  resetMockRouter("/");
  setWindowSize(1_400, 800);
  let openWorkspaceSearch = (): void => {
    throw new Error("Search capability unavailable");
  };
  function ConversationSearchProbe(): React.JSX.Element {
    openWorkspaceSearch = useWorkspaceListRouteResources().openGlobalSearch;
    return <Text>Selected conversation</Text>;
  }
  registerMockRoute("/threads/[connectionId]/[threadId]", ConversationSearchProbe);
  const view = render(<V1RouteTree />);
  const { result } = renderHook(useMountedThreadNavigation);
  act(() => {
    result.current.navigation.selectThread(
      threadSelectionKey({ id: "selected", serverId: "server" }),
    );
  });
  act(openWorkspaceSearch);
  const sessionId = mockRouterHistory().at(-1)?.params.globalSearchSessionId;
  if (sessionId === undefined) {
    throw new Error("Expected desktop search session");
  }
  const session = searchRouteSessions.get(sessionId, workspaceRouteSessionOwner)?.session;
  if (session === undefined) {
    throw new Error("Expected retained desktop search");
  }
  act(() => session.changeText("selected result"));

  act(() => router.setParams({ globalSearchSessionId: undefined }));
  expect(searchRouteSessions.get(sessionId, workspaceRouteSessionOwner)?.session).toBe(session);
  act(() => {
    router.push({
      params: { connectionId: "server", globalSearchSessionId: sessionId, threadId: "result" },
      pathname: "/threads/[connectionId]/[threadId]",
    });
  });
  expect(view.UNSAFE_getByType(GlobalSearchScreen).props.session).toBe(session);
  expect(session.text$.peek()).toBe("selected result");
  setWindowSize(400, 800);
  view.unmount();
});

it("keeps the desktop Search component mounted while the right chat changes", () => {
  holdInitialDeepLink();
  setWindowSize(1_400, 800);
  registerMockRoute("/threads/[connectionId]/[threadId]", () => <Text>Selected conversation</Text>);
  resetMockRouter({
    params: { connectionId: "server", threadId: "first" },
    pathname: "/threads/[connectionId]/[threadId]",
  });
  const view = render(<V1RouteTree />);
  fireEvent.press(view.getByLabelText("Search threads and messages"));
  const search = view.UNSAFE_getByType(GlobalSearchScreen);
  fireEvent.press(view.getByLabelText("Search filters"));
  expect(view.getByLabelText("Search filters").props.accessibilityState.expanded).toBe(true);

  act(() => router.setParams({ globalSearchSessionId: undefined }));
  act(() => {
    router.push({
      params: { connectionId: "server", threadId: "second" },
      pathname: "/threads/[connectionId]/[threadId]",
    });
  });

  expect(view.UNSAFE_getByType(GlobalSearchScreen)).toBe(search);
  expect(view.getByLabelText("Search filters").props.accessibilityState.expanded).toBe(true);
  expect(view.queryByText("Search expired")).toBeNull();
  setWindowSize(400, 800);
  view.unmount();
});

it("does not resurrect a closed desktop Search after Back and a thread switch", () => {
  holdInitialDeepLink();
  setWindowSize(1_400, 800);
  registerMockRoute("/threads/[connectionId]/[threadId]", () => <Text>Selected conversation</Text>);
  resetMockRouter("/");
  act(() => {
    router.push({
      params: { connectionId: "server", threadId: "first" },
      pathname: "/threads/[connectionId]/[threadId]",
    });
  });
  const view = render(<V1RouteTree />);
  fireEvent.press(view.getByLabelText("Search threads and messages"));
  const sessionId = view.UNSAFE_getByType(GlobalSearchScreen).props.session.id;
  act(() => view.UNSAFE_getByType(GlobalSearchScreen).props.onClose());
  expect(searchRouteSessions.get(sessionId, workspaceRouteSessionOwner)).toBeNull();
  act(() => router.back());
  act(() => {
    router.push({
      params: { connectionId: "server", globalSearchSessionId: sessionId, threadId: "second" },
      pathname: "/threads/[connectionId]/[threadId]",
    });
  });

  expect(view.queryByTestId("sidebar-search")).toBeNull();
  expect(view.queryByText("Search expired")).toBeNull();
  setWindowSize(400, 800);
  view.unmount();
});

it("keeps the search session and chat origin while folding and unfolding", () => {
  holdInitialDeepLink();
  resetMockRouter("/");
  setWindowSize(1_400, 800);
  let openWorkspaceSearch = (): void => {
    throw new Error("Search capability unavailable");
  };
  function ConversationSearchProbe(): React.JSX.Element {
    openWorkspaceSearch = useWorkspaceListRouteResources().openGlobalSearch;
    return <Text>Selected conversation</Text>;
  }
  registerMockRoute("/threads/[connectionId]/[threadId]", ConversationSearchProbe);
  const view = render(<V1RouteTree />);
  const { result } = renderHook(useMountedThreadNavigation);
  act(() => {
    result.current.navigation.selectThread(
      threadSelectionKey({ id: "selected", serverId: "server" }),
    );
  });
  act(openWorkspaceSearch);
  const searchSessionId = mockRouterHistory().at(-1)?.params.globalSearchSessionId;
  expect(searchSessionId).toEqual(expect.any(String));

  setWindowSize(400, 800);
  expect(mockRouterHistory().at(-1)?.pathname).toBe("/search");
  expect(mockRouterHistory()[1]?.params.globalSearchSessionId).toBeUndefined();
  expect(view.getByTestId("sidebar-search")).toBeTruthy();
  expect(searchRouteSessions.get(searchSessionId, workspaceRouteSessionOwner)).not.toBeNull();

  setWindowSize(1_400, 800);
  expect(mockRouterHistory().at(-1)?.pathname).toBe("/threads/[connectionId]/[threadId]");
  expect(mockRouterHistory().at(-1)?.params.globalSearchSessionId).toBe(searchSessionId);
  expect(view.getByTestId("sidebar-search")).toBeTruthy();
  act(() => view.UNSAFE_getByType(GlobalSearchScreen).props.onClose());
  expect(mockRouterHistory().at(-1)?.params.globalSearchSessionId).toBeUndefined();
  expect(mockRouterHistory().at(-1)?.params.threadId).toBe("selected");
  setWindowSize(400, 800);
  view.unmount();
});

it("keeps the real shell mounted while Router Back disposes the rendered drawing route", () => {
  holdInitialDeepLink();
  registerMockRoute("/drawing/[sessionId]", V1DrawingRoute);
  resetMockRouter("/");
  const admitted = drawingRouteSessions.open(workspaceRouteSessionOwner, {
    commit: async () => true,
    editing: true,
    initialSnapshot: null,
    mode: "drawing",
  });
  if (admitted.status === "capacity") {
    throw new Error("Expected drawing admission");
  }
  const view = render(<V1RouteTree />);
  const shell = view.getByTestId("v1-workspace-shell");

  act(() => {
    router.push({
      params: { sessionId: admitted.session.id },
      pathname: "/drawing/[sessionId]",
    });
  });
  expect(view.getByTestId("v1-workspace-shell")).toBe(shell);
  expect(drawingRouteSessions.get(admitted.session.id)).not.toBeNull();

  act(() => {
    router.back();
  });
  expect(view.getByTestId("v1-workspace-shell")).toBe(shell);
  expect(drawingRouteSessions.get(admitted.session.id)).toBeNull();

  const replacement = drawingRouteSessions.open(workspaceRouteSessionOwner, {
    commit: async () => true,
    editing: true,
    initialSnapshot: null,
    mode: "drawing",
  });
  if (replacement.status === "capacity") {
    throw new Error("Expected replacement drawing admission");
  }
  act(() => {
    router.push({
      params: { sessionId: replacement.session.id },
      pathname: "/drawing/[sessionId]",
    });
  });
  expect(drawingRouteSessions.get(replacement.session.id)).not.toBeNull();
  act(() => {
    router.replace("/settings");
  });
  expect(view.getByTestId("v1-workspace-shell")).toBe(shell);
  expect(drawingRouteSessions.get(replacement.session.id)).toBeNull();
  view.unmount();
});

it("keeps a mounted drawing available at its deadline and retires it on unmount", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(0);
  holdInitialDeepLink();
  registerMockRoute("/drawing/[sessionId]", V1DrawingRoute);
  const pending = Promise.withResolvers<boolean>();
  const admitted = drawingRouteSessions.open(workspaceRouteSessionOwner, {
    commit: () => pending.promise,
    editing: true,
    initialSnapshot: null,
    mode: "drawing",
  });
  if (admitted.status === "capacity") {
    throw new Error("Expected drawing admission");
  }
  resetMockRouter({
    params: { sessionId: admitted.session.id },
    pathname: "/drawing/[sessionId]",
  });
  const view = render(<V1RouteTree />);
  const settlement = drawingRouteSessions.commit(admitted.session.id, {
    pngDataUrl: "data:image/png;base64,AA==",
    snapshot: {},
  });

  act(() => {
    jest.advanceTimersByTime(ROUTE_SESSION_TTL_MS);
  });

  expect(view.getByTestId("drawing-workspace")).toBeTruthy();
  expect(drawingRouteSessions.get(admitted.session.id)).not.toBeNull();
  view.unmount();
  expect(drawingRouteSessions.get(admitted.session.id)).toBeNull();
  pending.resolve(true);
  await expect(settlement).resolves.toBe(false);
});

it.each([
  {
    component: V1DrawingRoute,
    destination: "/",
    params: { sessionId: "missing" },
    pathname: "/drawing/[sessionId]",
    title: "Drawing unavailable",
  },
  {
    component: V1DraftContentRoute,
    destination: "/new",
    params: { sessionId: "missing" },
    pathname: "/new/content/[sessionId]",
    title: "Content unavailable",
  },
  {
    component: V1DraftModelRoute,
    destination: "/new",
    params: { sessionId: "missing" },
    pathname: "/new/controls/model",
    title: "Model controls unavailable",
  },
])(
  "recovers the rendered $title direct entry through its visible control",
  ({ component, destination, params, pathname, title }) => {
    holdInitialDeepLink();
    if (destination === "/new") {
      newThreadService.open("server", null);
    }
    registerMockRoute(pathname, component);
    resetMockRouter({ params, pathname });
    const view = render(<V1RouteTree />);

    expect(view.getByText(title)).toBeTruthy();
    fireEvent.press(view.getByText("Back"));

    expect(mockRouterHistory().map((entry) => entry.pathname)).toEqual([destination]);
    view.unmount();
  },
);

it.each([
  { agentThreadId: "", kind: "invalid" },
  { agentThreadId: "missing-agent", kind: "unknown" },
])("keeps a rendered $kind agent detail out of the master route", async ({ agentThreadId }) => {
  holdInitialDeepLink();
  const pathname = "/threads/[connectionId]/[threadId]/agents/[agentThreadId]";
  registerMockRoute(pathname, V1AgentThreadRoute);
  resetMockRouter({
    params: { agentThreadId, connectionId: "server", threadId: "parent" },
    pathname,
  });
  const view = render(<V1RouteTree />);

  await waitFor(() => expect(view.getByText("Subagents unavailable")).toBeTruthy());
  fireEvent.press(view.getByText("Back"));

  expect(mockRouterHistory()).toEqual([
    {
      params: { connectionId: "server", threadId: "parent" },
      pathname: "/threads/[connectionId]/[threadId]",
    },
  ]);
  view.unmount();
});

it("disposes owner work exactly once when the real V1 layout unmounts", () => {
  holdInitialDeepLink();
  resetMockRouter("/");
  const session = searchRouteSessions.open(workspaceRouteSessionOwner);
  const cancelPending = jest.spyOn(session.session, "cancelPending");
  const view = render(<V1RouteTree layout />);

  view.unmount();

  expect(searchRouteSessions.get(session.id, workspaceRouteSessionOwner)).toBeNull();
  expect(cancelPending).toHaveBeenCalledTimes(1);
});

it("ignores stale edits after a newer route activation replaces the draft", () => {
  const service = new NewThreadService();
  const first = service.open("server", null);
  const second = service.open("other", "/current");
  service.changeProject(first.id, "/stale");
  service.changeWorkspaceMode(first.id, "isolated");
  expect(service.current()).toEqual(second);
});

it("replaces a rendered peer destination so Back cannot reveal it", () => {
  holdInitialDeepLink();
  registerV1NavigationRoutes();
  resetMockRouter({
    params: { sessionId: "missing" },
    pathname: "/drawing/[sessionId]",
  });
  const view = render(<V1RouteTree />);
  const { result } = renderHook(useMountedThreadNavigation);

  expect(view.getByText("Drawing unavailable")).toBeTruthy();

  act(() => {
    result.current.navigation.selectThread(
      threadSelectionKey({ id: "selected", serverId: "server" }),
    );
  });

  expect(mockRouterHistory()).toEqual([
    {
      params: { connectionId: "server", threadId: "selected" },
      pathname: "/threads/[connectionId]/[threadId]",
    },
  ]);
  expect(view.getByText("Server unavailable")).toBeTruthy();
  expect(view.queryByText("Drawing unavailable")).toBeNull();

  act(() => {
    router.back();
  });
  expect(mockRouterHistory()[0]?.pathname).toBe("/threads/[connectionId]/[threadId]");
  expect(view.getByText("Server unavailable")).toBeTruthy();
  expect(view.queryByText("Drawing unavailable")).toBeNull();
  view.unmount();
});

function RetainedDraftProbe(): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const change = useEvent((value: string): void => {
    setDraft(value);
  });
  return <TextInput accessibilityLabel="Retained draft" value={draft} onChangeText={change} />;
}

function ThreadLinkProbe({
  connectionId,
  readCapability,
}: {
  readonly connectionId: string;
  readonly readCapability: ThreadNavigationReadCapability;
}): React.JSX.Element {
  const { navigation } = useMountedThreadNavigation(readCapability);
  const thread = {
    id: "selected",
    serverId: connectionId,
    title: "Selected thread",
    preview: "",
    pinned: false,
    unread: 0,
  };
  const prepare = useEvent(() => navigation.prepareThreadLink(threadSelectionKey(thread)));
  return (
    <AppNoticeContext.Provider value={testNotice}>
      <ThreadRow
        link={navigation.getThreadLink(thread)}
        onNavigate={prepare}
        selected={false}
        server={undefined}
        thread={thread}
      />
    </AppNoticeContext.Provider>
  );
}

it.each(["server", "server/with space"])(
  "keeps the mounted conversation and edited draft after repeated real row taps on %s",
  async (connectionId) => {
    jest.mocked(useIsFocused).mockReturnValue(false);
    holdInitialDeepLink();
    registerMockRoute("/threads/[connectionId]/[threadId]", RetainedDraftProbe);
    resetMockRouter({
      params: { connectionId, threadId: "selected" },
      pathname: "/threads/[connectionId]/[threadId]",
    });
    const observeThread = jest.fn(async () => undefined);
    const view = await renderAsync(
      <>
        <V1RouteTree />
        <ThreadLinkProbe
          connectionId={connectionId}
          readCapability={{ ...remote, observeThread }}
        />
      </>,
    );
    const input = view.getByLabelText("Retained draft");
    await fireEventAsync.changeText(input, "Keep this draft");
    expect(view.getByDisplayValue("Keep this draft")).toBe(input);
    const dismiss = jest.spyOn(KeyboardController, "dismiss");
    dismiss.mockClear();
    const link = view.getByRole("link", { name: "Thread actions" });
    expect(link.props.href).toBe(`/threads/${encodeURIComponent(connectionId)}/selected`);
    await fireEventAsync.press(link);
    await fireEventAsync.press(link);
    expect(view.getByDisplayValue("Keep this draft")).toBe(input);
    expect(mockRouterHistory()).toHaveLength(1);
    expect(observeThread).not.toHaveBeenCalled();
    expect(dismiss).not.toHaveBeenCalled();
    await view.unmountAsync();
  },
);

it.each(["/threads/[connectionId]/[threadId]/queue", "/drawing/[sessionId]", "/search"])(
  "returns from %s through the row link without retaining the child screen",
  async (pathname) => {
    jest.mocked(useIsFocused).mockReturnValue(false);
    resetMockRouter("/");
    router.push({
      params: { connectionId: "server", threadId: "selected" },
      pathname: "/threads/[connectionId]/[threadId]",
    });
    router.push({
      params: { connectionId: "server", threadId: "selected", sessionId: "child" },
      pathname,
    });
    const view = await renderAsync(
      <ThreadLinkProbe connectionId="server" readCapability={remote} />,
    );
    await fireEventAsync.press(view.getByRole("link"));
    expect(mockRouterHistory().map((entry) => entry.pathname)).toEqual([
      "/",
      "/threads/[connectionId]/[threadId]",
    ]);
    await view.unmountAsync();
  },
);

it("preserves the visible search window on reselection without leaking it to another thread", async () => {
  resetMockRouter({
    pathname: "/threads/[connectionId]/[threadId]",
    params: {
      connectionId: "first",
      threadId: "selected",
      globalSearchSessionId: "search",
      searchWindowId: "window",
    },
  });
  const view = await renderAsync(<ThreadLinkProbe connectionId="first" readCapability={remote} />);
  await fireEventAsync.press(view.getByRole("link"));
  expect(mockRouterHistory().at(-1)?.params).toMatchObject({
    globalSearchSessionId: "search",
    searchWindowId: "window",
  });
  await view.rerenderAsync(<ThreadLinkProbe connectionId="second" readCapability={remote} />);
  await fireEventAsync.press(view.getByRole("link"));
  expect(mockRouterHistory().at(-1)?.params).toEqual({
    connectionId: "second",
    threadId: "selected",
    globalSearchSessionId: "search",
  });
  await view.unmountAsync();
});

it("resolves a recycled row link to the latest server and observes that qualified thread once", async () => {
  resetMockRouter("/");
  router.push({
    params: { connectionId: "first", threadId: "selected" },
    pathname: "/threads/[connectionId]/[threadId]",
  });
  const observeThread = jest.fn(async () => undefined);
  const capability = { ...remote, observeThread };
  const view = await renderAsync(
    <ThreadLinkProbe connectionId="first" readCapability={capability} />,
  );
  await view.rerenderAsync(<ThreadLinkProbe connectionId="second" readCapability={capability} />);
  await fireEventAsync.press(view.getByRole("link"));
  expect(mockRouterHistory().at(-1)?.params).toEqual({
    connectionId: "second",
    threadId: "selected",
  });
  expect(mockRouterHistory()).toHaveLength(2);
  expect(observeThread).toHaveBeenCalledTimes(1);
  expect(observeThread).toHaveBeenCalledWith("second", "selected");
  await fireEventAsync.press(view.getByRole("link"));
  expect(observeThread).toHaveBeenCalledTimes(1);
  await view.unmountAsync();
});

it("unmounts the previous conversation when selecting another thread", () => {
  resetMockRouter("/");
  act(() => {
    router.push({
      params: { connectionId: "server", threadId: "previous" },
      pathname: "/threads/[connectionId]/[threadId]",
    });
  });
  const { result } = renderHook(useMountedThreadNavigation);

  act(() => {
    result.current.navigation.selectThread(
      threadSelectionKey({ id: "selected", serverId: "server" }),
    );
  });

  expect(mockRouterHistory()).toEqual([
    { params: {}, pathname: "/" },
    {
      params: { connectionId: "server", threadId: "selected" },
      pathname: "/threads/[connectionId]/[threadId]",
    },
  ]);
});

it.each(["system", "header"] as const)(
  "pushes from All and %s Back renders All again",
  async (backKind) => {
    holdInitialDeepLink();
    setWindowSize(400, 800);
    registerV1NavigationRoutes();
    resetMockRouter("/");
    const view = await renderAsync(<V1RouteTree />);
    const { result } = renderHook(useMountedThreadNavigation);
    const destination = view.getByTestId("v1-workspace-destination", {
      includeHiddenElements: true,
    });

    expect(view.getByText("Threads")).toBeTruthy();
    await act(async () => {
      result.current.navigation.selectThread(
        threadSelectionKey({ id: "selected", serverId: "server" }),
      );
    });
    expect(mockRouterHistory().map((entry) => entry.pathname)).toEqual([
      "/",
      "/threads/[connectionId]/[threadId]",
    ]);
    expect(view.getByText("Server unavailable")).toBeTruthy();
    expect(view.queryByText("Threads")).toBeNull();
    expect(view.getByTestId("v1-workspace-destination")).toBe(destination);

    await act(async () => {
      if (backKind === "system") router.back();
      else result.current.navigation.closeActiveThread();
    });
    expect(mockRouterHistory().map((entry) => entry.pathname)).toEqual(["/"]);
    expect(view.getByText("Threads")).toBeTruthy();
    expect(view.queryByText("Server unavailable")).toBeNull();
    expect(view.getByTestId("v1-workspace-destination", { includeHiddenElements: true })).toBe(
      destination,
    );
    await view.unmountAsync();
  },
);

it("keeps the newer rendered destination after an older observer settles", async () => {
  holdInitialDeepLink();
  registerV1NavigationRoutes();
  resetMockRouter("/");
  const observation = Promise.withResolvers<void>();
  const controlledRemote: ThreadNavigationReadCapability = {
    observeThread: jest.fn(() => observation.promise),
    searchConversation: async () => ({ messages: [], newer: null, older: null, turns: [] }),
  };
  const view = render(<V1RouteTree />);
  const { result } = renderHook(() => useMountedThreadNavigation(controlledRemote));

  act(() => {
    result.current.navigation.selectThread(threadSelectionKey({ id: "older", serverId: "server" }));
  });
  expect(view.getByText("Server unavailable")).toBeTruthy();

  act(() => {
    router.push({
      params: { sessionId: "missing" },
      pathname: "/drawing/[sessionId]",
    });
  });
  expect(view.getByText("Drawing unavailable")).toBeTruthy();
  expect(view.queryByText("Server unavailable")).toBeNull();

  await act(async () => {
    observation.resolve();
    await observation.promise;
  });

  expect(view.getByText("Drawing unavailable")).toBeTruthy();
  expect(view.queryByText("Server unavailable")).toBeNull();
  view.unmount();
});

it("replaces /new after successful first admission and retires only the captured draft", async () => {
  // The real workspace anchor inserts the list beneath a cold /new link.
  resetMockRouter("/");
  router.push("/new");
  const drafts = new NewThreadService();
  const captured = drafts.open("server", null);
  const commands = {
    sendText: jest.fn(async () => "command"),
    startThread: jest.fn(async () => "thread"),
    startThreadInWorkspace: jest.fn(async () => "unused"),
  };
  const { result } = renderHook(useMountedThreadNavigation);

  await act(async () => {
    await createNewChatSubmission({
      closeDraft: (draftId) => {
        drafts.close(draftId);
      },
      commands,
      draftChat: captured,
      setActiveThreadId: result.current.navigation.selectThread,
    })("hello", { type: "start" }, {});
  });

  expect(drafts.current()).toBeNull();
  expect(mockRouterHistory().map((entry) => entry.pathname)).toEqual([
    "/",
    "/threads/[connectionId]/[threadId]",
  ]);
  act(() => {
    router.back();
  });
  expect(mockRouterHistory()[0]?.pathname).toBe("/");
});

it("retains the exact draft and /new destination when first admission fails", async () => {
  resetMockRouter("/new");
  const drafts = new NewThreadService();
  const captured = drafts.open("server", null);
  const commands = {
    sendText: jest.fn(async () => {
      throw new Error("admission failed");
    }),
    startThread: jest.fn(async () => "thread"),
    startThreadInWorkspace: jest.fn(async () => "unused"),
  };
  const { result } = renderHook(useMountedThreadNavigation);

  await expect(
    createNewChatSubmission({
      closeDraft: (draftId) => {
        drafts.close(draftId);
      },
      commands,
      draftChat: captured,
      setActiveThreadId: result.current.navigation.selectThread,
    })("hello", { type: "start" }, {}),
  ).rejects.toThrow("admission failed");

  expect(drafts.current()).toBe(captured);
  expect(mockRouterHistory().map((entry) => entry.pathname)).toEqual(["/new"]);
});

it("does not add a second /new entry when its server picker is already mounted", () => {
  resetMockRouter("/new");
  const { result } = renderHook(useWorkspaceRouteModel);
  act(() => {
    ensureV1NewThreadRoute(result.current.router, result.current.pathname);
  });
  expect(mockRouterHistory().map((entry) => entry.pathname)).toEqual(["/new"]);
});

it("removes retained peer conversations before opening a new-thread destination", () => {
  resetMockRouter("/");
  act(() => {
    router.push({
      params: { connectionId: "server", threadId: "first" },
      pathname: "/threads/[connectionId]/[threadId]",
    });
    router.push({ params: { sessionId: "child" }, pathname: "/drawing/[sessionId]" });
  });
  const { result } = renderHook(useWorkspaceRouteModel);

  act(() => {
    ensureV1NewThreadRoute(result.current.router, result.current.pathname);
  });

  expect(mockRouterHistory().map((entry) => entry.pathname)).toEqual(["/", "/new"]);
});

it.each(["/browser/[sessionId]", "/drawing/[sessionId]"])(
  "keeps the owning thread selected under the root modal %s",
  (pathname) => {
    resetMockRouter({
      params: {
        connectionId: "server",
        sessionId: "modal-session",
        threadId: "owning-thread",
      },
      pathname,
    });
    const { result } = renderHook(useWorkspaceRouteModel);

    expect(result.current.currentThread).toEqual({
      connectionId: { kind: "connectionId", value: "server" },
      threadId: { kind: "threadId", value: "owning-thread" },
    });
  },
);

it.each([400, 1400])(
  "preserves search and its origin through repeated result selection at width %s",
  (width) => {
    setWindowSize(width, 800);
    const session = searchRouteSessions.open(workspaceRouteSessionOwner);
    session.session.changeText("retained query");
    session.session.submit();
    session.session.rememberScroll(180);
    resetMockRouter("/");
    router.push({
      params: { connectionId: "server", threadId: "previous" },
      pathname: "/threads/[connectionId]/[threadId]",
    });
    router.push({
      params: { connectionId: "server", globalSearchSessionId: session.id, threadId: "previous" },
      pathname: "/search",
    });
    const { result } = renderHook(useMountedThreadNavigation);
    act(() => result.current.navigation.openSearchThread(threadSearchTarget, "query"));
    act(() =>
      result.current.navigation.openSearchThread(
        {
          ...threadSearchTarget,
          hit: { ...threadSearchTarget.hit, threadId: "second-result" },
        },
        "query",
      ),
    );
    expect(mockRouterHistory().map((entry) => entry.pathname)).toEqual([
      "/",
      "/threads/[connectionId]/[threadId]",
      "/search",
      "/threads/[connectionId]/[threadId]",
    ]);
    expect(mockRouterHistory().at(-1)?.params.threadId).toBe("second-result");
    setWindowSize(width === 400 ? 1400 : 400, 800);
    act(() => result.current.navigation.closeActiveThread());
    expect(mockRouterHistory().at(-1)?.pathname).toBe("/search");
    expect(result.current.route.globalSearchSessionId).toBe(session.id);
    expect(searchRouteSessions.get(session.id, workspaceRouteSessionOwner)?.session).toBe(
      session.session,
    );
    expect(session.session.text$.peek()).toBe("retained query");
    expect(session.session.scrollOffset).toBe(180);
    act(() => router.back());
    expect(mockRouterHistory().at(-1)?.params.threadId).toBe("previous");
  },
);

it("falls back deterministically from an unavailable direct entry", () => {
  resetMockRouter("/drawing/missing");
  act(() => {
    recoverUnavailableRoute(router, "/");
  });
  expect(mockRouterHistory().map((entry) => entry.pathname)).toEqual(["/"]);
});

it("retires the previous route session on replacement and the current one on unmount", () => {
  const close = jest.fn();
  const releases: string[] = [];
  const retain = jest.fn((id: string) => () => {
    releases.push(id);
  });
  const view = renderHook(
    ({ id }) => {
      useRouteSessionLifetime(id, close, retain);
    },
    { initialProps: { id: "first" } },
  );
  view.rerender({ id: "second" });
  expect(close).toHaveBeenCalledWith("first");
  view.unmount();
  expect(close.mock.calls).toEqual([["first"], ["second"]]);
  expect(releases).toEqual(["first", "second"]);
});

it("captures the original V1 subagent workspace before opening its route", () => {
  const parsed = v1ThreadRouteParams({ connectionId: "server", threadId: "root" });
  if (parsed.status === "invalid") {
    throw new Error("Expected valid route parameters");
  }
  resetMockRouter({
    params: { agentThreadId: "agent-a", connectionId: "server", threadId: "root" },
    pathname: "/threads/[connectionId]/[threadId]/agents/[agentThreadId]",
  });
  const view = renderHook(() => useThreadRouteNavigation(router, parsed.value));
  const summaries = [];

  act(() => {
    view.result.current.openAgents({
      initialThreadId: null,
      parentThread: null,
      parentThreadId: "agent-a",
      summaries,
    });
  });
  const destination = mockRouterHistory().at(-1);
  expect(destination).toEqual({
    params: {
      connectionId: "server",
      sessionId: expect.stringMatching(/^agents-/u),
      threadId: "root",
    },
    pathname: "/threads/[connectionId]/[threadId]/agents",
  });
  const sessionId = destination?.params?.sessionId;
  expect(typeof sessionId).toBe("string");
  if (typeof sessionId !== "string") {
    throw new Error("Expected an agent route session id");
  }
  expect(agentRouteSessions.get(sessionId, threadRouteSessionOwner(parsed.value))?.request).toEqual(
    {
      initialThreadId: null,
      parentThread: null,
      parentThreadId: "agent-a",
      summaries,
    },
  );
});

it("carries the owning thread into the root drawing modal", () => {
  const parsed = v1ThreadRouteParams({ connectionId: "server", threadId: "root" });
  if (parsed.status === "invalid") {
    throw new Error("Expected valid route parameters");
  }
  resetMockRouter({
    params: { connectionId: "server", threadId: "root" },
    pathname: "/threads/[connectionId]/[threadId]",
  });
  const view = renderHook(() => useThreadRouteNavigation(router, parsed.value));

  act(() => {
    view.result.current.openDrawing({
      commit: async () => true,
      editing: true,
      initialSnapshot: null,
      mode: "drawing",
    });
  });

  expect(mockRouterHistory().at(-1)).toEqual({
    params: {
      connectionId: "server",
      sessionId: expect.stringMatching(/^drawing-/u),
      threadId: "root",
    },
    pathname: "/drawing/[sessionId]",
  });
});

const projectListFixture = {
  connectionId: "project-server",
  key: "project-key",
  lastUsedAt: 1,
  name: "Example project",
  path: "/private/example",
  pinned: true,
  serverLabel: null,
  subtitle: "/private/example",
  unread: false,
};

function ProjectLaunchRoot(): React.JSX.Element {
  const resources = useWorkspaceListRouteResources();
  return (
    <>
      <Pressable onPress={() => resources.openSidebarProject(projectListFixture)}>
        <Text>Open example project</Text>
      </Pressable>
      <V1AllRoute />
    </>
  );
}

it("opens a project through native-stack history without changing the root sidebar scope", () => {
  holdInitialDeepLink();
  setWindowSize(400, 800);
  resetMockRouter("/");
  registerMockRoute("/", ProjectLaunchRoot, { retainWhenCovered: true });
  const view = render(<V1RouteTree />);
  const header = view.getByTestId("thread-list-header-row");
  const orb = view.getByTestId("global-voice-slot");
  const search = view.getByLabelText("Search threads and messages");
  fireEvent.press(view.getByText("Open example project"));
  const entry = mockRouterHistory().at(-1);
  expect(entry?.pathname).toBe("/project/[sessionId]");
  expect(JSON.stringify(entry?.params)).not.toContain(projectListFixture.path);
  expect(view.getByLabelText("Project Example project")).toBeVisible();
  expect(view.getAllByLabelText("Search threads and messages")).toHaveLength(1);
  expect(view.getAllByTestId("global-voice-slot")).toHaveLength(1);
  expect(view.getByTestId("thread-list-header-row")).toBe(header);
  expect(view.getByTestId("global-voice-slot")).toBe(orb);
  expect(view.getByLabelText("Search threads and messages")).toBe(search);
  expect(
    within(view.getByTestId("workspace-list-scenes")).queryByTestId("thread-list-header-row", {
      includeHiddenElements: true,
    }),
  ).toBeNull();
  fireEvent.press(view.getByLabelText("Back to projects"));
  expect(mockRouterHistory().map((route) => route.pathname)).toEqual(["/"]);
  expect(view.getByText("Threads")).toBeVisible();
  expect(view.queryByLabelText("Project Example project")).toBeNull();
  expect(view.getByTestId("thread-list-header-row")).toBe(header);
  expect(view.getByTestId("global-voice-slot")).toBe(orb);
  expect(view.getByLabelText("Search threads and messages")).toBe(search);
  view.unmount();
});

it("preserves the project destination when opening a chat and closing it through the header", () => {
  const session = projectListRouteSessions.open(projectListFixture);
  resetMockRouter("/");
  act(() => router.push({ pathname: "/project/[sessionId]", params: { sessionId: session.id } }));
  const { result } = renderHook(useMountedThreadNavigation);
  act(() =>
    result.current.navigation.selectThread(
      threadSelectionKey({ id: "project-chat", serverId: projectListFixture.connectionId }),
    ),
  );
  expect(mockRouterHistory().map((route) => route.pathname)).toEqual([
    "/",
    "/project/[sessionId]",
    "/threads/[connectionId]/[threadId]",
  ]);
  expect(mockRouterHistory().at(-1)?.params.projectListSessionId).toBe(session.id);
  act(() => result.current.navigation.closeActiveThread());
  expect(mockRouterHistory().at(-1)).toEqual({
    pathname: "/project/[sessionId]",
    params: { sessionId: session.id },
  });
});

it("keeps the project below search and returns to it when search closes", () => {
  holdInitialDeepLink();
  setWindowSize(400, 800);
  resetMockRouter("/");
  registerMockRoute("/", ProjectLaunchRoot);
  registerMockRoute("/project/[sessionId]", V1ProjectListRoute, { retainWhenCovered: true });
  const view = render(<V1RouteTree />);
  fireEvent.press(view.getByText("Open example project"));
  const projectEntry = mockRouterHistory().at(-1);
  fireEvent.press(view.getByLabelText("Search threads and messages"));
  expect(mockRouterHistory().map((entry) => entry.pathname)).toEqual([
    "/",
    "/project/[sessionId]",
    "/search",
  ]);
  expect(mockRouterHistory().at(-1)?.params.projectListSessionId).toBe(
    projectEntry?.params.sessionId,
  );
  fireEvent.press(view.getByLabelText("Back to threads"));
  expect(mockRouterHistory().at(-1)).toEqual(projectEntry);
  expect(view.getByLabelText("Project Example project")).toBeVisible();
  view.unmount();
});

it("pushes a draft above the project and keeps project paths out of draft route parameters", () => {
  resetMockRouter("/");
  router.push({ pathname: "/project/[sessionId]", params: { sessionId: "project-session" } });
  ensureV1NewThreadRoute(router, "/project/project-session");
  expect(mockRouterHistory().map((route) => route.pathname)).toEqual([
    "/",
    "/project/[sessionId]",
    "/new",
  ]);
  router.back();
  expect(mockRouterHistory().at(-1)?.params.sessionId).toBe("project-session");
});

it("replaces the admitted draft while preserving its project parent", () => {
  resetMockRouter("/");
  router.push({ pathname: "/project/[sessionId]", params: { sessionId: "project-session" } });
  ensureV1NewThreadRoute(router, "/project/project-session", "project-session");
  const { result } = renderHook(useMountedThreadNavigation);
  act(() =>
    result.current.navigation.selectThread(
      threadSelectionKey({ id: "admitted", serverId: "project-server" }),
    ),
  );
  expect(mockRouterHistory().map((entry) => entry.pathname)).toEqual([
    "/",
    "/project/[sessionId]",
    "/threads/[connectionId]/[threadId]",
  ]);
  act(() => result.current.navigation.closeActiveThread());
  expect(mockRouterHistory().at(-1)?.params.sessionId).toBe("project-session");
});

it("recovers an unmatched URL to the rendered thread list without leaving the bad URL in history", async () => {
  holdInitialDeepLink();
  setWindowSize(400, 800);
  registerMockRoute("/missing/deep/link", UnmatchedRoute);
  resetMockRouter("/missing/deep/link");
  const view = await renderAsync(<V1RouteTree />);
  await waitFor(() => {
    expect(view.getByText("Threads")).toBeTruthy();
  });
  expect(mockRouterHistory().map((entry) => entry.pathname)).toEqual(["/"]);
  expect(view.queryByText("Page unavailable")).toBeNull();
  await view.unmountAsync();
});

it.each([400, 1400])(
  "requires explicit thread selection even with cached rows at initial width %s",
  (width) => {
    holdInitialDeepLink();
    setWindowSize(width, 800);
    resetMockRouter("/");
    jest.spyOn(summaryView, "useThreadSummaryView").mockReturnValue({
      archived: [],
      error: null,
      phase: "ready",
      pinned: [],
      recent: [summary("cached-thread", { preview: "Cached preview" })],
      requestKey: null,
      revision: 1,
      selected: [],
      subagents: [],
    });
    const view = render(<V1RouteTree />);
    expect(view.getByText("cached-thread")).toBeVisible();
    expect(mockRouterHistory()).toEqual([{ params: {}, pathname: "/" }]);
    setWindowSize(width === 400 ? 1400 : 400, 800);
    expect(view.getByText("cached-thread")).toBeVisible();
    expect(mockRouterHistory()).toEqual([{ params: {}, pathname: "/" }]);
    view.unmount();
  },
);

it("retains the wide conversation through project and filter changes", () => {
  holdInitialDeepLink();
  setWindowSize(1400, 800);
  resetMockRouter({
    pathname: "/threads/[connectionId]/[threadId]",
    params: { connectionId: "server", threadId: "selected" },
  });
  registerMockRoute("/threads/[connectionId]/[threadId]", () => (
    <Text testID="retained-conversation">Selected chat</Text>
  ));
  const view = render(<V1RouteTree />);
  const conversation = view.getByTestId("retained-conversation");
  const threadEntry = mockRouterHistory().at(-1);
  act(() => view.UNSAFE_getByType(ThreadSidebar).props.onOpenProject(projectListFixture));
  expect(view.getByLabelText("Project Example project")).toBeVisible();
  act(() => view.UNSAFE_getByType(MobileThreads).props.onFilterChange("unread"));
  act(() => view.UNSAFE_getByType(MobileThreads).props.onModeChange("archived"));
  expect(mockRouterHistory().at(-1)).toEqual(threadEntry);
  expect(view.getByTestId("retained-conversation")).toBe(conversation);
  act(() => view.UNSAFE_getByType(MobileThreads).props.onBackToProjects());
  expect(mockRouterHistory().at(-1)).toEqual(threadEntry);
  expect(view.getByTestId("retained-conversation")).toBe(conversation);
  view.unmount();
});

it("restores the same project page and offset in either list presentation", () => {
  holdInitialDeepLink();
  setWindowSize(400, 800);
  resetMockRouter("/");
  registerMockRoute("/", ProjectLaunchRoot);
  const view = render(<V1RouteTree />);
  fireEvent.press(view.getByText("Open example project"));
  act(() => view.UNSAFE_getByType(MobileThreads).props.onLoadMoreProject(84));
  act(() => view.UNSAFE_getByType(MobileThreads).props.onOffsetChange(260));
  act(() => router.back());
  setWindowSize(1400, 800);
  act(() => view.UNSAFE_getByType(ThreadSidebar).props.onOpenProject(projectListFixture));
  expect(view.UNSAFE_getByType(MobileThreads).props.projectLimit).toBe(84);
  expect(view.UNSAFE_getByType(MobileThreads).props.initialOffset).toBe(260);
  act(() => view.UNSAFE_getByType(MobileThreads).props.onLoadMoreProject(120));
  act(() => view.UNSAFE_getByType(MobileThreads).props.onOffsetChange(400));
  act(() =>
    view
      .UNSAFE_getByType(MobileThreads)
      .props.onOpenProject({ ...projectListFixture, key: "other", path: "/other", name: "Other" }),
  );
  expect(view.UNSAFE_getByType(MobileThreads).props.projectLimit).not.toBe(120);
  expect(view.UNSAFE_getByType(MobileThreads).props.initialOffset).toBe(0);
  fireEvent.press(view.getByLabelText("Back to projects"));
  setWindowSize(400, 800);
  fireEvent.press(view.getByText("Open example project"));
  expect(view.UNSAFE_getByType(MobileThreads).props.projectLimit).toBe(120);
  expect(view.UNSAFE_getByType(MobileThreads).props.initialOffset).toBe(400);
  view.unmount();
});

it.each([400, 1400])(
  "keeps one catalog header and history through project navigation and resize from %s",
  (width) => {
    holdInitialDeepLink();
    setWindowSize(width, 800);
    resetMockRouter("/");
    registerMockRoute("/", ProjectLaunchRoot);
    const view = render(<V1RouteTree />);
    const header = view.getByTestId("thread-list-header-row");
    const orb = view.getByTestId("global-voice-slot");
    const search = view.getByLabelText("Search threads and messages");
    fireEvent.press(view.getByText("Open example project"));
    const history = mockRouterHistory();
    expect(history.at(-1)?.pathname).toBe("/project/[sessionId]");
    expect(view.getByLabelText("Project Example project")).toBeVisible();
    setWindowSize(width === 400 ? 1400 : 400, 800);
    expect(mockRouterHistory()).toEqual(history);
    expect(view.getByLabelText("Project Example project")).toBeVisible();
    expect(view.getByTestId("thread-list-header-row")).toBe(header);
    expect(view.getByTestId("global-voice-slot")).toBe(orb);
    expect(view.getByLabelText("Search threads and messages")).toBe(search);
    fireEvent.press(view.getByLabelText("Back to projects"));
    expect(mockRouterHistory().map((entry) => entry.pathname)).toEqual(["/"]);
    expect(view.queryByLabelText("Project Example project")).toBeNull();
    expect(view.getByText("Threads")).toBeVisible();
    view.unmount();
  },
);

it("returns to the project browsed beside a retained chat after folding", () => {
  holdInitialDeepLink();
  setWindowSize(400, 800);
  resetMockRouter("/");
  registerMockRoute("/", ProjectLaunchRoot);
  registerMockRoute("/threads/[connectionId]/[threadId]", () => (
    <Text testID="retained-chat">Chat</Text>
  ));
  const view = render(<V1RouteTree />);
  fireEvent.press(view.getByText("Open example project"));
  const { result } = renderHook(useMountedThreadNavigation);
  act(() =>
    result.current.navigation.selectThread(
      threadSelectionKey({ serverId: "server", id: "selected" }),
    ),
  );
  const chat = view.getByTestId("retained-chat");
  setWindowSize(1400, 800);
  act(() =>
    view
      .UNSAFE_getByType(MobileThreads)
      .props.onOpenProject({ ...projectListFixture, key: "other", path: "/other", name: "Other" }),
  );
  expect(view.getByLabelText("Project Other")).toBeVisible();
  expect(view.getByTestId("retained-chat")).toBe(chat);
  expect(mockRouterHistory().at(-1)?.params.threadId).toBe("selected");
  setWindowSize(400, 800);
  expect(view.getByTestId("retained-chat")).toBe(chat);
  act(() => result.current.navigation.closeActiveThread());
  expect(view.getByLabelText("Project Other")).toBeVisible();
  expect(view.queryByLabelText("Project Example project")).toBeNull();
  view.unmount();
});

it("keeps wide project chrome mounted while its catalog suspends", () => {
  holdInitialDeepLink();
  setWindowSize(1400, 800);
  resetMockRouter("/");
  registerMockRoute("/", ProjectLaunchRoot);
  const loading = new Promise<never>(() => undefined);
  jest.spyOn(summaryView, "useThreadSummaryView").mockImplementation((_database, request) => {
    if (request?.projectCwd === projectListFixture.path) throw loading;
    return null;
  });
  const view = render(<V1RouteTree />);
  const header = view.getByTestId("thread-list-header-row");
  const orb = view.getByTestId("global-voice-slot");
  fireEvent.press(view.getByText("Open example project"));
  expect(view.getByLabelText("Project Example project")).toBeVisible();
  expect(view.getByTestId("thread-list-header-row")).toBe(header);
  expect(view.getByTestId("global-voice-slot")).toBe(orb);
  fireEvent.press(view.getByLabelText("Back to projects"));
  expect(view.getByText("Threads")).toBeVisible();
  view.unmount();
});

it("opens a project draft above the selected catalog while a wide conversation is active", () => {
  holdInitialDeepLink();
  setWindowSize(1400, 800);
  resetMockRouter("/");
  registerMockRoute("/", ProjectLaunchRoot);
  registerMockRoute("/threads/[connectionId]/[threadId]", () => <Text>Chat</Text>);
  const view = render(<V1RouteTree />);
  fireEvent.press(view.getByText("Open example project"));
  const { result } = renderHook(useMountedThreadNavigation);
  act(() =>
    result.current.navigation.selectThread(
      threadSelectionKey({ serverId: "server", id: "selected" }),
    ),
  );
  act(() => view.UNSAFE_getByType(MobileThreads).props.onNewThread());
  expect(newThreadService.current()?.cwd).toBe(projectListFixture.path);
  expect(newThreadService.current()?.connectionId).toBe(projectListFixture.connectionId);
  expect(mockRouterHistory().map((entry) => entry.pathname)).toEqual([
    "/",
    "/project/[sessionId]",
    "/new",
  ]);
  act(() => router.back());
  expect(view.getByLabelText("Project Example project")).toBeVisible();
  view.unmount();
});
