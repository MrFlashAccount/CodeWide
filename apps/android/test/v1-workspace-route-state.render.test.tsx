import type { BottomTabBarProps } from "expo-router/js-tabs";
import type { NavigationState } from "expo-router/build/react-navigation/routers";

import { activateWorkspaceTab } from "../src/routeComposition/workspaceTabActivation";
import { workspaceTabState } from "../src/routeComposition/workspaceTabNavigation";
import {
  workspaceThreadsCatalogState,
  workspaceThreadsRouteState,
  workspaceThreadsSearchSessionId,
} from "../src/routeComposition/workspaceThreadsRouteState";

type NavigationRoute = NavigationState["routes"][number];

function navigationState(
  key: string,
  index: number,
  routes: NavigationRoute[],
  type = "stack",
): NavigationState {
  return {
    index,
    key,
    routeNames: routes.map((route) => route.name),
    routes,
    stale: false,
    type,
  };
}

function workspaceState({
  searchSessionId = "search-session",
  tabIndex = 0,
}: {
  readonly searchSessionId?: string;
  readonly tabIndex?: number;
} = {}): NavigationState {
  const lists = navigationState("lists", 0, [
    { key: "project", name: "project/[sessionId]", params: { sessionId: "project-session" } },
  ]);
  const threads = navigationState("threads", 1, [
    { key: "lists-route", name: "(lists)", state: lists },
    { key: "search", name: "search", params: { globalSearchSessionId: searchSessionId } },
  ]);
  const pulls = navigationState("pulls", 1, [
    { key: "pulls-root", name: "pulls/index" },
    { key: "pull-detail", name: "pulls/[connectionId]/[pullRequestKey]/changes" },
  ]);
  const tabs = navigationState(
    "tabs",
    tabIndex,
    [
      { key: "pull-tab", name: "(pull-requests)", state: pulls },
      { key: "threads-tab", name: "(threads)", state: threads },
    ],
    "tab",
  );
  return navigationState("root", 0, [
    {
      key: "workspace",
      name: "(workspace)",
      state: navigationState("workspace-stack", 0, [
        { key: "tabs-route", name: "(tabs)", state: tabs },
      ]),
    },
  ]);
}

it("resolves retained Threads and Search by names while Pull requests is active", () => {
  const root = workspaceState({ tabIndex: 0 });

  expect(workspaceThreadsRouteState(root)).toMatchObject({
    state: { key: "threads" },
    status: "ready",
  });
  expect(workspaceThreadsCatalogState(root)).toMatchObject({
    state: { key: "lists" },
    status: "ready",
  });
  expect(workspaceThreadsSearchSessionId(root)).toBe("search-session");
});

it("returns deterministic unavailable results for missing and duplicate topology", () => {
  expect(workspaceThreadsRouteState(navigationState("root", 0, []))).toEqual({
    reason: "missing-workspace",
    status: "unavailable",
  });
  const root = workspaceState();
  const workspace = root.routes[0];
  const duplicate = navigationState("root", 0, [workspace, { ...workspace, key: "workspace-2" }]);
  expect(workspaceThreadsRouteState(duplicate)).toEqual({
    reason: "duplicate-workspace",
    status: "unavailable",
  });
});

it("maps catalog modes from exact route names independent of route order", () => {
  const state: BottomTabBarProps["state"] = {
    history: [{ key: "pull-tab", type: "route" }],
    index: 0,
    key: "tabs",
    preloadedRouteKeys: [],
    routeNames: ["(pull-requests)", "(threads)"],
    routes: [
      { key: "pull-tab", name: "(pull-requests)" },
      { key: "threads-tab", name: "(threads)" },
    ],
    stale: false,
    type: "tab",
  };

  expect(workspaceTabState(state)).toMatchObject({
    activeMode: "pullRequests",
    pullRequestsRoute: { key: "pull-tab" },
    status: "ready",
    threadsRoute: { key: "threads-tab" },
  });
  expect(
    workspaceTabState({
      ...state,
      routeNames: ["(threads)", "unexpected"],
      routes: [
        { key: "threads-tab", name: "(threads)" },
        { key: "unexpected", name: "unexpected" },
      ],
    }),
  ).toEqual({ reason: "unknown-route", status: "unavailable" });
});

it("emits tabPress for reselect and honors cancellation before navigation", () => {
  const state: BottomTabBarProps["state"] = {
    history: [{ key: "threads-tab", type: "route" }],
    index: 1,
    key: "tabs",
    preloadedRouteKeys: [],
    routeNames: ["(pull-requests)", "(threads)"],
    routes: [
      { key: "pull-tab", name: "(pull-requests)" },
      { key: "threads-tab", name: "(threads)" },
    ],
    stale: false,
    type: "tab",
  };
  const emitTabPress = jest.fn(() => true);
  const navigate = jest.fn();

  activateWorkspaceTab(state, "pullRequests", { emitTabPress, navigate });
  expect(emitTabPress).toHaveBeenCalledWith("pull-tab");
  expect(navigate).not.toHaveBeenCalled();

  emitTabPress.mockReturnValue(false);
  activateWorkspaceTab(state, "threads", { emitTabPress, navigate });
  expect(emitTabPress).toHaveBeenLastCalledWith("threads-tab");
  expect(navigate).not.toHaveBeenCalled();
});
