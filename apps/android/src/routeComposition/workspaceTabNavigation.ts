import type { BottomTabBarProps } from "expo-router/js-tabs";

import type { CatalogMode } from "../features/pullRequests/CatalogModeBar";

const workspaceTabRouteNames = {
  pullRequests: "(pull-requests)",
  threads: "(threads)",
} as const;

type WorkspaceTabRouteName = (typeof workspaceTabRouteNames)[keyof typeof workspaceTabRouteNames];
type WorkspaceTabRoute = BottomTabBarProps["state"]["routes"][number];
type WorkspaceTabRoutesResult =
  | {
      readonly pullRequestsRoute: WorkspaceTabRoute;
      readonly status: "ready";
      readonly threadsRoute: WorkspaceTabRoute;
    }
  | {
      readonly reason: "duplicate-route" | "missing-route" | "unknown-route";
      readonly status: "unavailable";
    };
type WorkspaceTabRouteLookup =
  | { readonly status: "duplicate" }
  | { readonly status: "missing" }
  | { readonly route: WorkspaceTabRoute; readonly status: "ready" };

export type WorkspaceTabStateResult =
  | {
      readonly activeMode: CatalogMode;
      readonly activeRoute: WorkspaceTabRoute;
      readonly pullRequestsRoute: WorkspaceTabRoute;
      readonly status: "ready";
      readonly threadsRoute: WorkspaceTabRoute;
    }
  | {
      readonly reason:
        | "duplicate-route"
        | "missing-active-route"
        | "missing-route"
        | "unknown-route";
      readonly status: "unavailable";
    };

/** Resolves the two workspace tabs by exact route name, never by numeric position. */
export function workspaceTabState(state: BottomTabBarProps["state"]): WorkspaceTabStateResult {
  const routes = workspaceTabRoutes(state);
  if (routes.status === "unavailable") {
    return routes;
  }
  const activeRoute = state.routes[state.index];
  if (activeRoute === undefined || !isWorkspaceTabRouteName(activeRoute.name)) {
    return { reason: "missing-active-route", status: "unavailable" };
  }
  return {
    activeMode: modeForWorkspaceTabRoute(activeRoute.name),
    activeRoute,
    pullRequestsRoute: routes.pullRequestsRoute,
    status: "ready",
    threadsRoute: routes.threadsRoute,
  };
}

export function workspaceTabRouteNameForMode(mode: CatalogMode): WorkspaceTabRouteName {
  return mode === "threads" ? workspaceTabRouteNames.threads : workspaceTabRouteNames.pullRequests;
}

function modeForWorkspaceTabRoute(routeName: WorkspaceTabRouteName): CatalogMode {
  return routeName === workspaceTabRouteNames.threads ? "threads" : "pullRequests";
}

function isWorkspaceTabRouteName(routeName: string): routeName is WorkspaceTabRouteName {
  return (
    routeName === workspaceTabRouteNames.threads ||
    routeName === workspaceTabRouteNames.pullRequests
  );
}

function workspaceTabRoutes(state: BottomTabBarProps["state"]): WorkspaceTabRoutesResult {
  if (state.routes.some((route) => !isWorkspaceTabRouteName(route.name))) {
    return { reason: "unknown-route", status: "unavailable" };
  }
  return knownWorkspaceTabRoutes(state);
}

function knownWorkspaceTabRoutes(state: BottomTabBarProps["state"]): WorkspaceTabRoutesResult {
  const threads = findUniqueTabRoute(state, workspaceTabRouteNames.threads);
  const pullRequests = findUniqueTabRoute(state, workspaceTabRouteNames.pullRequests);
  if (threads.status === "duplicate" || pullRequests.status === "duplicate") {
    return { reason: "duplicate-route", status: "unavailable" };
  }
  if (threads.status === "missing" || pullRequests.status === "missing") {
    return { reason: "missing-route", status: "unavailable" };
  }
  return {
    pullRequestsRoute: pullRequests.route,
    status: "ready",
    threadsRoute: threads.route,
  };
}

function findUniqueTabRoute(
  state: BottomTabBarProps["state"],
  routeName: WorkspaceTabRouteName,
): WorkspaceTabRouteLookup {
  let match: WorkspaceTabRoute | undefined;
  for (const route of state.routes) {
    if (route.name !== routeName) {
      continue;
    }
    if (match !== undefined) {
      return { status: "duplicate" };
    }
    match = route;
  }
  return match === undefined ? { status: "missing" } : { route: match, status: "ready" };
}
