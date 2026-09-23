import { workspaceProjectSessionId } from "../src/routeComposition/workspaceProjectNavigation";
import { join } from "node:path";

import { getRoutes } from "expo-router/build/getRoutes";
import { getReactNavigationConfig } from "expo-router/build/getReactNavigationConfig";
import { getStateFromPath } from "expo-router/build/fork/getStateFromPath";
import {
  findDivergentState,
  getPayloadFromStateRoute,
} from "expo-router/build/global-state/stateUtils";
import { StackActions, StackRouter } from "expo-router/build/react-navigation/routers/StackRouter";
import requireContext from "expo-router/build/testing-library/require-context-ponyfill";

function applicationConfig() {
  const tree = getRoutes(requireContext(join(__dirname, "../app")), {
    ignoreEntryPoints: true,
    ignoreRequireErrors: true,
    platform: "android",
  });
  return getReactNavigationConfig(tree, true);
}

it("targets the workspace list when dismissing a nested thread to the unversioned root", () => {
  const home = getStateFromPath("/", applicationConfig());
  if (home === undefined) throw new Error("Application home does not resolve");
  const threadName = "threads/[connectionId]/[threadId]";
  const options = {
    routeNames: ["(lists)", threadName],
    routeParamList: {},
    routeGetIdList: {},
  };
  const workspaceRouter = StackRouter({ initialRouteName: "(lists)" });
  const initial = workspaceRouter.getInitialState(options);
  const opened = workspaceRouter.getStateForAction(
    initial,
    StackActions.push(threadName, { connectionId: "server", threadId: "thread" }),
    options,
  );
  if (opened === null || opened.stale !== false) throw new Error("Thread did not open");
  const root = {
    ...initial,
    key: "application-root",
    routeNames: ["(workspace)", "+not-found"],
    routes: [{ key: "workspace-route", name: "(workspace)", state: opened }],
  };
  const { navigationState, actionStateRoute } = findDivergentState(home, root);
  expect(navigationState.key).toBe(opened.key);
  if (actionStateRoute === undefined) throw new Error("Home action has no destination");
  const target = getPayloadFromStateRoute(actionStateRoute);
  expect(target.screen).toBe("(lists)");
  expect(target.params?.screen).toBe("index");
  if (target.screen === undefined) throw new Error("Home screen is missing");
  const returned = workspaceRouter.getStateForAction(
    opened,
    StackActions.popTo(target.screen, target.params),
    options,
  );
  expect(returned?.routes.map((route) => route.name)).toEqual(["(lists)"]);
  expect(returned?.index).toBe(0);
});

it("opens a qualified assistant-chat link through the existing thread destination", () => {
  const connectionId = "voice/server with space";
  const threadId = "supervisor?#%/thread";
  const state = getStateFromPath(
    `/threads/${encodeURIComponent(connectionId)}/${encodeURIComponent(threadId)}`,
    applicationConfig(),
  );
  const destination = state?.routes[0]?.state?.routes.at(-1);
  expect(destination).toMatchObject({
    name: "threads/[connectionId]/[threadId]",
    params: { connectionId, threadId },
  });
});

it("anchors a direct thread link to the list and resolves obsolete links to recovery", () => {
  const config = applicationConfig();
  const direct = getStateFromPath("/threads/server/thread", config);
  expect(direct?.routes[0]?.name).toBe("(workspace)");
  expect(direct?.routes[0]?.state?.routes.map((route) => route.name)).toEqual([
    "(lists)",
    "threads/[connectionId]/[threadId]",
  ]);
  for (const pathname of ["/v1", "/v1/threads/server/thread", "/missing/deep/link"]) {
    expect(getStateFromPath(pathname, config)?.routes[0]?.name).toBe("+not-found");
  }
});

it("keeps All and project in one nested navigator beneath the shared list header", () => {
  const state = getStateFromPath("/project/project-session", applicationConfig());
  const workspace = state?.routes[0];
  expect(workspace?.name).toBe("(workspace)");
  expect(workspace?.state?.routes.map((route) => route.name)).toEqual(["(lists)"]);
  const list = workspace?.state?.routes[0];
  expect(list?.state?.routes.map((route) => route.name)).toEqual(["index", "project/[sessionId]"]);
  expect(list?.state?.routes.at(-1)?.params).toMatchObject({ sessionId: "project-session" });
});

it("reads catalog selection through Expo's runtime root wrapper without using stale thread params", () => {
  const listOptions = {
    routeNames: ["index", "project/[sessionId]"],
    routeParamList: {},
    routeGetIdList: {},
  };
  const listRouter = StackRouter({ initialRouteName: "index" });
  const list = listRouter.getStateForAction(
    listRouter.getInitialState(listOptions),
    StackActions.push("project/[sessionId]", { sessionId: "selected-project" }),
    listOptions,
  );
  if (list === null) throw new Error("Project navigation failed");
  const workspaceOptions = {
    routeNames: ["(lists)", "thread"],
    routeParamList: {},
    routeGetIdList: {},
  };
  const workspaceRouter = StackRouter({ initialRouteName: "(lists)" });
  const initial = workspaceRouter.getInitialState(workspaceOptions);
  const workspace = workspaceRouter.getStateForAction(
    { ...initial, routes: initial.routes.map((route) => ({ ...route, state: list })) },
    StackActions.push("thread", { projectListSessionId: "stale" }),
    workspaceOptions,
  );
  if (workspace === null) throw new Error("Thread navigation failed");
  const state = {
    ...initial,
    routes: [
      {
        key: "root",
        name: "__root",
        state: {
          ...initial,
          routes: [{ key: "workspace", name: "(workspace)", state: workspace }],
        },
      },
    ],
  };
  expect(workspaceProjectSessionId(state)).toBe("selected-project");
});

it.each(["NAVIGATE", "POP_TO"] as const)(
  "preserves the screen key for a repeated %s link and keeps Back anchored to the catalog",
  (type) => {
    const threadName = "threads/[connectionId]/[threadId]";
    const options = { routeNames: ["(lists)", threadName], routeParamList: {}, routeGetIdList: {} };
    const stack = StackRouter({ initialRouteName: "(lists)" });
    const params = { connectionId: "server/with space", threadId: "selected" };
    const opened = stack.getStateForAction(
      stack.getInitialState(options),
      { type: "NAVIGATE", payload: { name: threadName, params } },
      options,
    );
    if (opened === null) throw new Error("Thread did not open");
    const selectedKey = opened.routes.at(-1)?.key;
    const repeated = stack.getStateForAction(
      opened,
      { type, payload: { name: threadName, params } },
      options,
    );
    if (repeated === null) throw new Error("Repeated link was rejected");
    expect(repeated.routes).toHaveLength(2);
    expect(repeated.routes.at(-1)?.key).toBe(selectedKey);
    const switched = stack.getStateForAction(
      repeated,
      { type, payload: { name: threadName, params: { ...params, connectionId: "other server" } } },
      options,
    );
    if (switched === null) throw new Error("Qualified link was rejected");
    expect(switched.routes).toHaveLength(2);
    expect(switched.routes.at(-1)?.params).toEqual({ ...params, connectionId: "other server" });
    const back = stack.getStateForAction(switched, { type: "GO_BACK" }, options);
    expect(back?.routes.map((route) => route.name)).toEqual(["(lists)"]);
  },
);

it("keeps the catalog in history when opening a thread from the focused list", () => {
  const options = {
    routeNames: ["(lists)", "threads/[connectionId]/[threadId]"],
    routeParamList: {},
    routeGetIdList: {},
  };
  const router = StackRouter({ initialRouteName: "(lists)" });
  const list = router.getInitialState(options);
  const destination = {
    name: "threads/[connectionId]/[threadId]",
    params: { connectionId: "server", threadId: "next" },
  };
  const navigated = router.getStateForAction(
    list,
    { type: "NAVIGATE", payload: destination },
    options,
  );
  const popped = router.getStateForAction(list, { type: "POP_TO", payload: destination }, options);
  expect(navigated?.routes.map((route) => route.name)).toEqual([
    "(lists)",
    "threads/[connectionId]/[threadId]",
  ]);
  expect(popped?.routes.map((route) => route.name)).toEqual(["threads/[connectionId]/[threadId]"]);
});

it("anchors a cold draft URL to the catalog before replacing the admitted thread", () => {
  const state = getStateFromPath("/new", applicationConfig());
  expect(state?.routes[0]?.state?.routes.map((route) => route.name)).toEqual(["(lists)", "new"]);
});
