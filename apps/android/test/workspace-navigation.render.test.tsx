import { useSelector } from "@legendapp/state/react";
import { act, fireEvent, render, renderHook, waitFor } from "@testing-library/react-native";
import { Linking, Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { V1WorkspaceRouteComposition } from "../app/v1/V1WorkspaceRouteComposition";
import { MountedV1Workspace } from "../app/v1/_layout";
import V1DrawingRoute from "../app/v1/drawing/[sessionId]";
import V1AllRoute from "../app/v1/index";
import V1DraftContentRoute from "../app/v1/new/content/[sessionId]";
import V1DraftModelRoute from "../app/v1/new/controls/model";
import V1AgentThreadRoute from "../app/v1/threads/[connectionId]/[threadId]/agents/[agentThreadId]";
import V1ThreadRoute from "../app/v1/threads/[connectionId]/[threadId]/index";
import { useThreadRouteNavigation } from "../app/v1/threads/[connectionId]/[threadId]/threadRouteNavigation";
import { ensureV1NewThreadRoute, useV1WorkspaceRouteModel } from "../app/v1/V1WorkspaceRouteModel";
import { recoverUnavailableRoute } from "../src/components/navigation/routeRecovery";
import { createNewChatSubmission } from "../src/features/projects/newChatSubmission";
import { resolveSubagentRouteSelection } from "../src/features/agents/subagentRouteSelection";
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
  v1ThreadRouteParams,
  workspaceRouteSessionOwner,
} from "../src/services/threads/threadRouteParams";
import { useRouteSessionLifetime } from "../src/services/useRouteSessionLifetime";
import {
  clearMockRoutes,
  mockRouterHistory,
  registerMockRoute,
  resetMockRouter,
  router,
} from "./mocks/ExpoRouter";

const remote: ThreadNavigationReadCapability = {
  native: false,
  observeThread: async () => undefined,
  searchConversation: async () => ({ messages: [], newer: null, older: null, turns: [] }),
  threadDetails: null,
  threadUiStateDatabase: null,
};

function useMountedThreadNavigation(readCapability: ThreadNavigationReadCapability = remote) {
  const route = useV1WorkspaceRouteModel();
  const navigation = useThreadNavigationService(
    readCapability,
    route.threadRouter,
    () => undefined,
  );
  return { navigation, route };
}

afterEach(() => {
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
      {layout ? <MountedV1Workspace /> : <V1WorkspaceRouteComposition />}
    </SafeAreaProvider>
  );
}

function holdInitialDeepLink(): void {
  jest.spyOn(Linking, "getInitialURL").mockReturnValue(new Promise(() => undefined));
}

function registerV1NavigationRoutes(): void {
  registerMockRoute("/v1", V1AllRoute);
  registerMockRoute("/v1/drawing/[sessionId]", V1DrawingRoute);
  registerMockRoute("/v1/threads/[connectionId]/[threadId]", V1ThreadRoute);
}

function DraftView({ service }: { service: NewThreadService }): React.JSX.Element {
  const draft = useSelector(() => service.draft$.get());
  return <Text>{draft === null ? "Threads" : `draft:${draft.id}:${draft.cwd ?? "none"}`}</Text>;
}

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

it("pushes from the rendered All destination and Back renders All again", () => {
  holdInitialDeepLink();
  registerV1NavigationRoutes();
  resetMockRouter("/v1");
  const view = render(<V1RouteTree />);
  const { result } = renderHook(useMountedThreadNavigation);

  expect(view.getByText("Threads")).toBeTruthy();
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

  act(() => {
    router.back();
  });
  expect(mockRouterHistory().map((entry) => entry.pathname)).toEqual(["/v1"]);
  expect(view.getByText("Threads")).toBeTruthy();
  expect(view.queryByText("Server unavailable")).toBeNull();
  view.unmount();
});

it("keeps the newer rendered destination after an older observer settles", async () => {
  holdInitialDeepLink();
  registerV1NavigationRoutes();
  resetMockRouter("/v1");
  const observation = Promise.withResolvers<void>();
  const controlledRemote: ThreadNavigationReadCapability = {
    native: false,
    observeThread: jest.fn(() => observation.promise),
    searchConversation: async () => ({ messages: [], newer: null, older: null, turns: [] }),
    threadDetails: null,
    threadUiStateDatabase: null,
  };
  const view = render(<V1RouteTree />);
  const { result } = renderHook(() => useMountedThreadNavigation(controlledRemote));

  act(() => {
    result.current.navigation.selectThread(
      threadSelectionKey({ id: "older", serverId: "server" }),
    );
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
    "/v1/threads/[connectionId]/[threadId]",
  ]);
  act(() => {
    router.back();
  });
  expect(mockRouterHistory()[0]?.pathname).toBe("/v1/threads/[connectionId]/[threadId]");
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

it("keeps invalid and unknown agent detail ids out of the master state", () => {
  expect(resolveSubagentRouteSelection([], { status: "invalid" })).toEqual({
    status: "unavailable",
  });
  expect(resolveSubagentRouteSelection([], { status: "selected", threadId: "missing" })).toEqual({
    status: "unavailable",
  });
  expect(resolveSubagentRouteSelection([], { status: "master" })).toEqual({ status: "master" });
});

it("qualifies nested subagent routes by their immediate parent", () => {
  const parsed = v1ThreadRouteParams({ connectionId: "server", threadId: "root" });
  if (parsed.status === "invalid") {
    throw new Error("Expected valid route parameters");
  }
  resetMockRouter({
    params: { agentThreadId: "agent-a", connectionId: "server", threadId: "root" },
    pathname: "/v1/threads/[connectionId]/[threadId]/agents/[agentThreadId]",
  });
  const view = renderHook(() => useThreadRouteNavigation(router, parsed.value));

  act(() => {
    view.result.current.openAgents(null, "agent-a");
  });
  expect(mockRouterHistory().at(-1)).toEqual({
    params: { connectionId: "server", parentAgentThreadId: "agent-a", threadId: "root" },
    pathname: "/v1/threads/[connectionId]/[threadId]/agents",
  });

  act(() => {
    view.result.current.openAgents("agent-b", "agent-a");
  });
  expect(mockRouterHistory().at(-1)).toEqual({
    params: {
      agentThreadId: "agent-b",
      connectionId: "server",
      parentAgentThreadId: "agent-a",
      threadId: "root",
    },
    pathname: "/v1/threads/[connectionId]/[threadId]/agents/[agentThreadId]",
  });
});
