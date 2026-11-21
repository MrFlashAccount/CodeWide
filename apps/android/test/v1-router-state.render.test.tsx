import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getRoutes } from "expo-router/build/getRoutes";
import { getReactNavigationConfig } from "expo-router/build/getReactNavigationConfig";
import { getStateFromPath } from "expo-router/build/fork/getStateFromPath";
import { StackRouter } from "expo-router/build/react-navigation/routers/StackRouter";
import requireContext from "expo-router/build/testing-library/require-context-ponyfill";

import { workspaceProjectSessionId } from "../src/routeComposition/workspaceProjectNavigation";

type RouteState = {
  readonly index?: number;
  readonly key?: string;
  readonly routes: readonly RouteStateEntry[];
};
type RouteStateEntry = {
  readonly name: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly state?: RouteState;
};

function applicationConfig() {
  const tree = getRoutes(requireContext(join(__dirname, "../app")), {
    ignoreEntryPoints: true,
    ignoreRequireErrors: true,
    platform: "android",
  });
  return getReactNavigationConfig(tree, true);
}

function childState(state: RouteState, routeName: string): RouteState {
  const child = state.routes.find((route) => route.name === routeName)?.state;
  if (child === undefined) throw new Error(`Missing ${routeName} state`);
  return child;
}

function workspaceState(pathname: string): RouteState {
  const state = getStateFromPath(pathname, applicationConfig());
  const workspace = state?.routes.find((route) => route.name === "(workspace)")?.state;
  if (workspace === undefined) throw new Error(`${pathname} did not resolve inside the workspace`);
  return workspace;
}

function routeNames(state: RouteState): string[] {
  return state.routes.map((route) => route.name);
}

it("declares no workspace catalog anchor and exact local subtree anchors", () => {
  const rootLayout = readFileSync(join(__dirname, "../app/(workspace)/_layout.tsx"), "utf8");
  const threadsLayout = readFileSync(
    join(__dirname, "../app/(workspace)/(tabs)/(threads)/_layout.tsx"),
    "utf8",
  );
  const pullRequestsLayout = readFileSync(
    join(__dirname, "../app/(workspace)/(tabs)/(pull-requests)/_layout.tsx"),
    "utf8",
  );

  expect(rootLayout).not.toContain("unstable_settings");
  expect(threadsLayout).toContain(
    'unstable_settings = { anchor: "(lists)", initialRouteName: "(lists)" }',
  );
  expect(pullRequestsLayout).toContain(
    'unstable_settings = { anchor: "pulls/index", initialRouteName: "pulls/index" }',
  );
});

it("generates the exact Threads root and Projects parent chains", () => {
  const home = workspaceState("/");
  expect(routeNames(home)).toEqual(["(tabs)"]);
  const homeThreads = childState(childState(home, "(tabs)"), "(threads)");
  expect(routeNames(homeThreads)).toEqual(["(lists)"]);
  expect(routeNames(childState(homeThreads, "(lists)")).at(-1)).toBe("index");

  const projects = workspaceState("/projects");
  expect(routeNames(projects)).toEqual(["(tabs)"]);
  expect(routeNames(childState(childState(projects, "(tabs)"), "(threads)"))).toEqual([
    "(lists)",
    "projects/index",
  ]);
});

it("keeps All and project in the nested Threads catalog navigator", () => {
  const workspace = workspaceState("/project/project-session");
  const threads = childState(childState(workspace, "(tabs)"), "(threads)");
  expect(routeNames(threads)).toEqual(["(lists)"]);
  const list = childState(threads, "(lists)");
  expect(routeNames(list)).toEqual(["index", "project/[sessionId]"]);
  expect(list.routes.at(-1)?.params).toMatchObject({ sessionId: "project-session" });
});

it("generates a PR catalog chain without a Threads parent", () => {
  const workspace = workspaceState("/pulls");
  expect(routeNames(workspace)).toEqual(["(tabs)"]);
  expect(routeNames(childState(childState(workspace, "(tabs)"), "(pull-requests)"))).toEqual([
    "pulls/index",
  ]);
  expect(JSON.stringify(workspace)).not.toContain("(threads)");
});

it.each([
  ["/pulls/server/pr", "pulls/[connectionId]/[pullRequestKey]/index"],
  ["/pulls/server/pr/changes", "pulls/[connectionId]/[pullRequestKey]/changes"],
] as const)("anchors %s only beneath the PR catalog", (pathname, detailRoute) => {
  const workspace = workspaceState(pathname);
  expect(routeNames(workspace)).toEqual(["(tabs)"]);
  expect(routeNames(childState(childState(workspace, "(tabs)"), "(pull-requests)"))).toEqual([
    "pulls/index",
    detailRoute,
  ]);
  expect(JSON.stringify(workspace)).not.toContain("(threads)");
});

it("anchors a canonical thread beneath the Threads catalog", () => {
  const connectionId = "voice/server with space";
  const threadId = "supervisor?#%/thread";
  const workspace = workspaceState(
    `/threads/${encodeURIComponent(connectionId)}/${encodeURIComponent(threadId)}`,
  );
  expect(routeNames(workspace)).toEqual(["(tabs)"]);
  const threads = childState(childState(workspace, "(tabs)"), "(threads)");
  expect(routeNames(threads)).toEqual(["(lists)", "threads/[connectionId]/[threadId]"]);
  expect(threads.routes.at(-1)?.params).toMatchObject({ connectionId, threadId });
});

it("keeps invisible groups out of every permanent public URL", () => {
  const paths = [
    "/",
    "/project/project-session",
    "/projects",
    "/pulls",
    "/pulls/server/pr",
    "/pulls/server/pr/changes",
    "/threads/server/thread",
  ];
  for (const pathname of paths) {
    expect(getStateFromPath(pathname, applicationConfig())).toBeDefined();
    expect(pathname).not.toMatch(/\((?:threads|pull-requests)\)/u);
  }
});

it("reads project selection through the exact nested Threads catalog owner", () => {
  const listOptions = {
    routeNames: ["index", "project/[sessionId]"],
    routeParamList: {},
    routeGetIdList: {},
  };
  const listRouter = StackRouter({ initialRouteName: "index" });
  const list = listRouter.getStateForAction(
    listRouter.getInitialState(listOptions),
    { type: "PUSH", payload: { name: "project/[sessionId]", params: { sessionId: "selected" } } },
    listOptions,
  );
  if (list === null) throw new Error("Project navigation failed");
  const state = {
    routes: [
      {
        key: "root",
        name: "__root",
        state: {
          routes: [
            {
              key: "workspace",
              name: "(workspace)",
              state: {
                routes: [
                  {
                    key: "tabs",
                    name: "(tabs)",
                    state: {
                      routes: [
                        {
                          key: "threads",
                          name: "(threads)",
                          state: { routes: [{ key: "lists", name: "(lists)", state: list }] },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    ],
  };
  expect(workspaceProjectSessionId(state)).toBe("selected");
});

it("anchors a cold draft URL inside the Threads subtree", () => {
  const workspace = workspaceState("/new");
  expect(routeNames(workspace)).toEqual(["(tabs)"]);
  expect(routeNames(childState(childState(workspace, "(tabs)"), "(threads)"))).toEqual([
    "(lists)",
    "new",
  ]);
});

it("resolves obsolete and unknown links to recovery", () => {
  const config = applicationConfig();
  for (const pathname of ["/v1", "/v1/threads/server/thread", "/missing/deep/link"]) {
    expect(getStateFromPath(pathname, config)?.routes[0]?.name).toBe("+not-found");
  }
});
