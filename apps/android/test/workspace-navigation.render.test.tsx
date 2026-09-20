import { useSelector } from "@legendapp/state/react";
import { act, fireEvent, render, renderHook, waitFor, within } from "@testing-library/react-native";
import { Dimensions, Linking, StyleSheet, Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { V1WorkspaceRouteComposition } from "../app/v1/V1WorkspaceRouteComposition";
import { MountedV1Workspace } from "../app/v1/_layout";
import V1DrawingRoute from "../app/v1/drawing/[sessionId]";
import V1AllRoute from "../app/v1/index";
import V1DraftContentRoute from "../app/v1/new/content/[sessionId]";
import V1DraftModelRoute from "../app/v1/new/controls/model";
import V1AgentThreadRoute from "../app/v1/threads/[connectionId]/[threadId]/agents/[agentThreadId]";
import V1ThreadLayout from "../app/v1/threads/[connectionId]/[threadId]/_layout";
import V1ThreadRoute from "../app/v1/threads/[connectionId]/[threadId]/index";
import { useThreadRouteNavigation } from "../app/v1/threads/[connectionId]/[threadId]/threadRouteNavigation";
import { ensureV1NewThreadRoute, useV1WorkspaceRouteModel } from "../app/v1/V1WorkspaceRouteModel";
import { recoverUnavailableRoute } from "../src/components/navigation/routeRecovery";
import { workspaceRuntime } from "../src/data/workspace-runtime";
import { createGlobalSupervisorVisibilityPolicy } from "../src/data/globalSupervisorVisibility";
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
import { useServerScope } from "../src/services/servers/serverScope";
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
  const route = useV1WorkspaceRouteModel();
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
          {layout ? <MountedV1Workspace /> : <V1WorkspaceRouteComposition />}
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
  registerMockRoute("/v1", V1AllRoute);
  registerMockRoute("/v1/drawing/[sessionId]", V1DrawingRoute);
  registerMockRoute("/v1/threads/[connectionId]/[threadId]", V1ThreadRoute);
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
  const previousVisibility = workspaceRuntime.globalSupervisorVisibility;
  workspaceRuntime.globalSupervisorVisibility = createGlobalSupervisorVisibilityPolicy(() => null);
  try {
    const pathname = "/v1/threads/[connectionId]/[threadId]";
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
      pathname: "/v1/threads/[connectionId]/[threadId]/attachments",
    });
    view.unmount();
  } finally {
    workspaceRuntime.globalSupervisorVisibility = previousVisibility;
  }
});

it("consumes desktop default selection after the first thread choice", () => {
  const resetThreadList = jest.fn();
  const { result } = renderHook(() => useServerScope([], resetThreadList));

  expect(result.current.desktopDefaultThreadEnabled).toBe(true);
  act(() => {
    result.current.consumeDesktopDefaultThread();
  });
  expect(result.current.desktopDefaultThreadEnabled).toBe(false);
});

it("does not arm desktop default selection over an initial thread route", () => {
  const { result } = renderHook(() => useServerScope([], jest.fn(), false));

  expect(result.current.desktopDefaultThreadEnabled).toBe(false);
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
  resetMockRouter("/v1");
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
  resetMockRouter("/v1");
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
  resetMockRouter("/v1");
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
  resetMockRouter("/v1");
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
  expect(mockRouterHistory().at(-1)?.pathname).toBe("/v1/threads/[connectionId]/[threadId]");

  setWindowSize(400, 800);

  expect(view.queryByText("Threads")).toBeNull();
  expect(view.getByText("Server unavailable")).toBeVisible();
  expect(view.getByTestId("v1-workspace-destination")).toBe(destination);
  view.unmount();
});

it("stretches the single-column workspace across compact phone landscape", () => {
  holdInitialDeepLink();
  registerV1NavigationRoutes();
  resetMockRouter("/v1");
  setWindowSize(700, 360);
  const view = render(<V1RouteTree />);
  const list = view.getByTestId("v1-workspace-list");
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

  expect(destinationStyle).toEqual(
    expect.objectContaining({ bottom: 0, left: 0, right: 0, top: 0 }),
  );
  expect(destinationStyle).not.toHaveProperty("maxWidth");
  expect(view.getByText("Server unavailable")).toBeVisible();

  setWindowSize(400, 800);
  view.unmount();
});

it("carries the selected thread into a browser attachment modal", () => {
  holdInitialDeepLink();
  const pathname = "/v1/threads/[connectionId]/[threadId]";
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
    pathname: "/v1/browser/[sessionId]",
  });
  view.unmount();
});

it("replaces the mobile thread list with global search instead of the conversation pane", () => {
  holdInitialDeepLink();
  resetMockRouter("/v1");
  const view = render(<V1RouteTree />);

  fireEvent.press(view.getByLabelText("Search threads and messages"));

  expect(view.getByTestId("sidebar-search")).toBeTruthy();
  expect(mockRouterHistory().at(-1)?.pathname).toBe("/v1/search");
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
      pathname: "/v1/threads/[connectionId]/[threadId]",
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
] as const)("keeps %s Threads and Search actions in one stable header row", (_mode, width) => {
  holdInitialDeepLink();
  resetMockRouter("/v1");
  setWindowSize(width, 800);
  const view = render(<V1RouteTree />);
  const threadsHeader = view.getByTestId("thread-list-header-row");
  const threadsHeaderStyle = StyleSheet.flatten(threadsHeader.props.style);

  expect(within(threadsHeader).getByText("Threads")).toBeTruthy();
  expect(within(threadsHeader).getByLabelText("Search threads and messages")).toBeTruthy();
  expect(within(threadsHeader).getByLabelText(/Thread filters/u)).toBeTruthy();
  expect(view.queryByText("Search")).toBeNull();

  fireEvent.press(within(threadsHeader).getByLabelText("Search threads and messages"));

  const searchHeader = view.getByTestId("global-search-header-row");
  expect(StyleSheet.flatten(searchHeader.props.style)).toEqual(threadsHeaderStyle);
  expect(within(searchHeader).getByText("Search")).toBeTruthy();
  expect(within(searchHeader).getByLabelText("Back to threads")).toBeTruthy();
  expect(within(searchHeader).getByLabelText("Search filters")).toBeTruthy();
  expect(
    within(view.getByTestId("search-top-input")).queryByLabelText("Search filters"),
  ).toBeNull();

  fireEvent.press(within(searchHeader).getByLabelText("Back to threads"));
  expect(within(view.getByTestId("thread-list-header-row")).getByText("Threads")).toBeTruthy();
  setWindowSize(400, 800);
  view.unmount();
});

it("unmounts the covered mobile conversation while global search is open", () => {
  holdInitialDeepLink();
  registerV1NavigationRoutes();
  resetMockRouter("/v1");
  const view = render(<V1RouteTree />);
  const { result } = renderHook(useMountedThreadNavigation);
  act(() => {
    result.current.navigation.selectThread(
      threadSelectionKey({ id: "selected", serverId: "server" }),
    );
  });

  let searchControl = view.getByLabelText("Search threads and messages", {
    includeHiddenElements: true,
  });
  while (typeof searchControl.props.onPress !== "function") {
    const parent = searchControl.parent;
    if (parent === null) {
      throw new Error("Expected the hidden mobile search control to expose its press action");
    }
    searchControl = parent;
  }
  act(searchControl.props.onPress);

  expect(mockRouterHistory().map((entry) => entry.pathname)).toEqual(["/v1", "/v1/search"]);
  expect(mockRouterHistory().at(-1)?.params.threadId).toBe("selected");

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
    { params: {}, pathname: "/v1" },
    {
      params: { connectionId: "server", threadId: "selected" },
      pathname: "/v1/threads/[connectionId]/[threadId]",
    },
  ]);
  view.unmount();
});

it("closes desktop search without reverting the chat selected from its results", () => {
  holdInitialDeepLink();
  resetMockRouter("/v1");
  const view = render(<V1RouteTree />);
  setWindowSize(1_400, 800);

  fireEvent.press(view.getByLabelText("Search threads and messages"));
  const searchSessionId = mockRouterHistory().at(-1)?.params.globalSearchSessionId;
  if (searchSessionId === undefined) {
    throw new Error("Expected global search session id");
  }
  act(() => {
    router.replace({
      params: {
        connectionId: "server",
        globalSearchSessionId: searchSessionId,
        threadId: "result",
      },
      pathname: "/v1/threads/[connectionId]/[threadId]",
    });
  });
  fireEvent.press(view.getByLabelText("Back to threads"));

  expect(mockRouterHistory().at(-1)).toEqual({
    params: { connectionId: "server", threadId: "result" },
    pathname: "/v1/threads/[connectionId]/[threadId]",
  });
  setWindowSize(400, 800);
  view.unmount();
});

it("keeps the real shell mounted while Router Back disposes the rendered drawing route", () => {
  holdInitialDeepLink();
  registerMockRoute("/v1/drawing/[sessionId]", V1DrawingRoute);
  resetMockRouter("/v1");
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
      pathname: "/v1/drawing/[sessionId]",
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
      pathname: "/v1/drawing/[sessionId]",
    });
  });
  expect(drawingRouteSessions.get(replacement.session.id)).not.toBeNull();
  act(() => {
    router.replace("/v1/settings");
  });
  expect(view.getByTestId("v1-workspace-shell")).toBe(shell);
  expect(drawingRouteSessions.get(replacement.session.id)).toBeNull();
  view.unmount();
});

it("keeps a mounted drawing available at its deadline and retires it on unmount", async () => {
  jest.useFakeTimers();
  jest.setSystemTime(0);
  holdInitialDeepLink();
  registerMockRoute("/v1/drawing/[sessionId]", V1DrawingRoute);
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
    pathname: "/v1/drawing/[sessionId]",
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
    destination: "/v1",
    params: { sessionId: "missing" },
    pathname: "/v1/drawing/[sessionId]",
    title: "Drawing unavailable",
  },
  {
    component: V1DraftContentRoute,
    destination: "/v1/new",
    params: { sessionId: "missing" },
    pathname: "/v1/new/content/[sessionId]",
    title: "Content unavailable",
  },
  {
    component: V1DraftModelRoute,
    destination: "/v1/new",
    params: { sessionId: "missing" },
    pathname: "/v1/new/controls/model",
    title: "Model controls unavailable",
  },
])(
  "recovers the rendered $title direct entry through its visible control",
  ({ component, destination, params, pathname, title }) => {
    holdInitialDeepLink();
    if (destination === "/v1/new") {
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
  const pathname = "/v1/threads/[connectionId]/[threadId]/agents/[agentThreadId]";
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
      pathname: "/v1/threads/[connectionId]/[threadId]",
    },
  ]);
  view.unmount();
});

it("disposes owner work exactly once when the real V1 layout unmounts", () => {
  holdInitialDeepLink();
  resetMockRouter("/v1");
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
    pathname: "/v1/drawing/[sessionId]",
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
      pathname: "/v1/threads/[connectionId]/[threadId]",
    },
  ]);
  expect(view.getByText("Server unavailable")).toBeTruthy();
  expect(view.queryByText("Drawing unavailable")).toBeNull();

  act(() => {
    router.back();
  });
  expect(mockRouterHistory()[0]?.pathname).toBe("/v1/threads/[connectionId]/[threadId]");
  expect(view.getByText("Server unavailable")).toBeTruthy();
  expect(view.queryByText("Drawing unavailable")).toBeNull();
  view.unmount();
});

it("unmounts the previous conversation when selecting another thread", () => {
  resetMockRouter("/v1");
  act(() => {
    router.push({
      params: { connectionId: "server", threadId: "previous" },
      pathname: "/v1/threads/[connectionId]/[threadId]",
    });
  });
  const { result } = renderHook(useMountedThreadNavigation);

  act(() => {
    result.current.navigation.selectThread(
      threadSelectionKey({ id: "selected", serverId: "server" }),
    );
  });

  expect(mockRouterHistory()).toEqual([
    { params: {}, pathname: "/v1" },
    {
      params: { connectionId: "server", threadId: "selected" },
      pathname: "/v1/threads/[connectionId]/[threadId]",
    },
  ]);
});

it("pushes from the rendered All destination and Back renders All again", () => {
  holdInitialDeepLink();
  registerV1NavigationRoutes();
  resetMockRouter("/v1");
  const view = render(<V1RouteTree />);
  const { result } = renderHook(useMountedThreadNavigation);
  const destination = view.getByTestId("v1-workspace-destination", {
    includeHiddenElements: true,
  });
  const list = view.getByTestId("v1-workspace-list");

  expect(view.getByText("Threads")).toBeTruthy();
  expect(list.props.pointerEvents).toBe("auto");
  expect(destination.props.pointerEvents).toBe("none");
  act(() => {
    result.current.navigation.selectThread(
      threadSelectionKey({ id: "selected", serverId: "server" }),
    );
  });
  expect(mockRouterHistory().map((entry) => entry.pathname)).toEqual([
    "/v1",
    "/v1/threads/[connectionId]/[threadId]",
  ]);
  expect(view.getByText("Server unavailable")).toBeTruthy();
  expect(view.queryByText("Threads")).toBeNull();
  expect(view.getByText("Threads", { includeHiddenElements: true })).toBeTruthy();
  expect(view.getByTestId("v1-workspace-list", { includeHiddenElements: true })).toBe(list);
  expect(list.props.pointerEvents).toBe("none");
  expect(view.getByTestId("v1-workspace-destination")).toBe(destination);
  expect(destination.props.pointerEvents).toBe("auto");

  act(() => {
    router.back();
  });
  expect(mockRouterHistory().map((entry) => entry.pathname)).toEqual(["/v1"]);
  expect(view.getByText("Threads")).toBeTruthy();
  expect(view.queryByText("Server unavailable")).toBeNull();
  expect(view.getByTestId("v1-workspace-list")).toBe(list);
  expect(list.props.pointerEvents).toBe("auto");
  expect(view.getByTestId("v1-workspace-destination", { includeHiddenElements: true })).toBe(
    destination,
  );
  expect(destination.props.pointerEvents).toBe("none");
  view.unmount();
});

it("keeps the newer rendered destination after an older observer settles", async () => {
  holdInitialDeepLink();
  registerV1NavigationRoutes();
  resetMockRouter("/v1");
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
      pathname: "/v1/drawing/[sessionId]",
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

it("replaces /v1/new after successful first admission and retires only the captured draft", async () => {
  resetMockRouter("/v1/new");
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
    "/v1",
    "/v1/threads/[connectionId]/[threadId]",
  ]);
  act(() => {
    router.back();
  });
  expect(mockRouterHistory()[0]?.pathname).toBe("/v1");
});

it("retains the exact draft and /v1/new destination when first admission fails", async () => {
  resetMockRouter("/v1/new");
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
  expect(mockRouterHistory().map((entry) => entry.pathname)).toEqual(["/v1/new"]);
});

it("does not add a second /v1/new entry when its server picker is already mounted", () => {
  resetMockRouter("/v1/new");
  const { result } = renderHook(useV1WorkspaceRouteModel);
  act(() => {
    ensureV1NewThreadRoute(result.current.router, result.current.pathname);
  });
  expect(mockRouterHistory().map((entry) => entry.pathname)).toEqual(["/v1/new"]);
});

it("removes retained peer conversations before opening a new-thread destination", () => {
  resetMockRouter("/v1");
  act(() => {
    router.push({
      params: { connectionId: "server", threadId: "first" },
      pathname: "/v1/threads/[connectionId]/[threadId]",
    });
    router.push({ params: { sessionId: "child" }, pathname: "/v1/drawing/[sessionId]" });
  });
  const { result } = renderHook(useV1WorkspaceRouteModel);

  act(() => {
    ensureV1NewThreadRoute(result.current.router, result.current.pathname);
  });

  expect(mockRouterHistory().map((entry) => entry.pathname)).toEqual(["/v1", "/v1/new"]);
});

it.each(["/v1/browser/[sessionId]", "/v1/drawing/[sessionId]"])(
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
    const { result } = renderHook(useV1WorkspaceRouteModel);

    expect(result.current.currentThread).toEqual({
      connectionId: { kind: "connectionId", value: "server" },
      threadId: { kind: "threadId", value: "owning-thread" },
    });
  },
);

it("keeps global search in the desktop list pane while replacing the conversation result", () => {
  const session = searchRouteSessions.open(workspaceRouteSessionOwner);
  resetMockRouter({
    params: {
      connectionId: "server",
      globalSearchSessionId: session.id,
      threadId: "current",
    },
    pathname: "/v1/search",
  });
  const { result } = renderHook(() => {
    const route = useV1WorkspaceRouteModel(true);
    const navigation = useThreadNavigationService(remote, route.threadRouter);
    return { navigation, route };
  });
  expect(result.current.route.currentThread?.threadId.value).toBe("current");

  act(() => {
    result.current.navigation.openSearchThread(threadSearchTarget, "query");
  });

  expect(mockRouterHistory()).toEqual([
    {
      params: {},
      pathname: "/v1",
    },
    {
      params: {
        connectionId: "server",
        globalSearchSessionId: session.id,
        threadId: "search-result",
      },
      pathname: "/v1/threads/[connectionId]/[threadId]",
    },
  ]);
  expect(result.current.route.currentThread?.threadId.value).toBe("search-result");
  expect(result.current.route.globalSearchSessionId).toBe(session.id);
});

it("removes the previous desktop conversation when search selects another thread", () => {
  const session = searchRouteSessions.open(workspaceRouteSessionOwner);
  resetMockRouter("/v1");
  act(() => {
    router.push({
      params: { connectionId: "server", threadId: "previous" },
      pathname: "/v1/threads/[connectionId]/[threadId]",
    });
    router.push({
      params: {
        connectionId: "server",
        globalSearchSessionId: session.id,
        threadId: "previous",
      },
      pathname: "/v1/search",
    });
  });
  const { result } = renderHook(() => {
    const route = useV1WorkspaceRouteModel(true);
    return useThreadNavigationService(remote, route.threadRouter);
  });

  act(() => {
    result.current.openSearchThread(threadSearchTarget, "query");
  });

  expect(mockRouterHistory().map((entry) => entry.pathname)).toEqual([
    "/v1",
    "/v1/threads/[connectionId]/[threadId]",
  ]);
  expect(mockRouterHistory().at(-1)?.params.threadId).toBe("search-result");
});

it("pushes a mobile search result so Back returns to the search list", () => {
  const session = searchRouteSessions.open(workspaceRouteSessionOwner);
  resetMockRouter({
    params: { globalSearchSessionId: session.id },
    pathname: "/v1/search",
  });
  const { result } = renderHook(useMountedThreadNavigation);

  act(() => {
    result.current.navigation.openSearchThread(threadSearchTarget, "query");
  });

  expect(mockRouterHistory().map((entry) => entry.pathname)).toEqual([
    "/v1/search",
    "/v1/threads/[connectionId]/[threadId]",
  ]);
  expect(mockRouterHistory().at(-1)?.params.globalSearchSessionId).toBe(session.id);
});

it("falls back deterministically from an unavailable direct entry", () => {
  resetMockRouter("/v1/drawing/missing");
  act(() => {
    recoverUnavailableRoute(router, "/v1");
  });
  expect(mockRouterHistory().map((entry) => entry.pathname)).toEqual(["/v1"]);
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
    pathname: "/v1/threads/[connectionId]/[threadId]/agents/[agentThreadId]",
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
    pathname: "/v1/threads/[connectionId]/[threadId]/agents",
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
    pathname: "/v1/threads/[connectionId]/[threadId]",
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
    pathname: "/v1/drawing/[sessionId]",
  });
});
