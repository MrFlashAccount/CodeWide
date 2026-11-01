import type { NavigationState, PartialState } from "expo-router/build/react-navigation/routers";

/** Router state shape shared by exact retained-workspace topology lookups. */
export type WorkspaceRouteState = NavigationState | PartialState<NavigationState>;

type WorkspaceRouteRecord = WorkspaceRouteState["routes"][number];

/** Exact-name lookup result that distinguishes absent and invalid duplicate topology. */
export type WorkspaceRouteLookup =
  | { readonly status: "duplicate" }
  | { readonly status: "missing" }
  | { readonly route: WorkspaceRouteRecord; readonly status: "ready" };

type RouteLookupAccumulator = {
  duplicate: boolean;
  match: WorkspaceRouteRecord | undefined;
};

/** Finds one exact direct child without materializing or copying Router state. */
export function findUniqueDirectRoute(
  state: WorkspaceRouteState,
  name: string,
): WorkspaceRouteLookup {
  const accumulator: RouteLookupAccumulator = { duplicate: false, match: undefined };
  for (const route of state.routes) {
    recordNamedRoute(accumulator, route, name);
    if (accumulator.duplicate) {
      break;
    }
  }
  return routeLookup(accumulator);
}

/** Finds one exact route at any depth without materializing or copying Router state. */
export function findUniqueRouteDeep(
  state: WorkspaceRouteState | undefined,
  name: string,
): WorkspaceRouteLookup {
  if (state === undefined) {
    return { status: "missing" };
  }
  const accumulator: RouteLookupAccumulator = { duplicate: false, match: undefined };
  collectNamedRouteDeep(accumulator, state, name);
  return routeLookup(accumulator);
}

function collectNamedRouteDeep(
  accumulator: RouteLookupAccumulator,
  state: WorkspaceRouteState,
  name: string,
): void {
  for (const route of state.routes) {
    collectNamedRoute(accumulator, route, name);
    if (accumulator.duplicate) {
      return;
    }
  }
}

function collectNamedRoute(
  accumulator: RouteLookupAccumulator,
  route: WorkspaceRouteRecord,
  name: string,
): void {
  recordNamedRoute(accumulator, route, name);
  if (!accumulator.duplicate && route.state !== undefined) {
    collectNamedRouteDeep(accumulator, route.state, name);
  }
}

function recordNamedRoute(
  accumulator: RouteLookupAccumulator,
  route: WorkspaceRouteRecord,
  name: string,
): void {
  if (route.name !== name) {
    return;
  }
  if (accumulator.match === undefined) {
    accumulator.match = route;
    return;
  }
  accumulator.duplicate = true;
}

function routeLookup(accumulator: RouteLookupAccumulator): WorkspaceRouteLookup {
  if (accumulator.duplicate) {
    return { status: "duplicate" };
  }
  return accumulator.match === undefined
    ? { status: "missing" }
    : { route: accumulator.match, status: "ready" };
}
