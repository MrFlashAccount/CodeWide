import { useNavigationContainerRef } from "expo-router";
import type { NavigationState } from "expo-router/build/react-navigation/routers";
import { useSyncExternalStore } from "react";

import { useEvent } from "../react/useEvent";
import { routeSessionIdParam } from "../services/threads/threadRouteParams";
import {
  findUniqueDirectRoute,
  findUniqueRouteDeep,
  type WorkspaceRouteLookup,
  type WorkspaceRouteState,
} from "./workspaceRouteLookup";

export type WorkspaceThreadsRouteStateResult =
  | { readonly reason: WorkspaceThreadsUnavailableReason; readonly status: "unavailable" }
  | { readonly state: WorkspaceRouteState; readonly status: "ready" };

type WorkspaceThreadsUnavailableReason =
  | "duplicate-lists"
  | "duplicate-tabs"
  | "duplicate-threads"
  | "duplicate-workspace"
  | "lists-state-unavailable"
  | "missing-lists"
  | "missing-tabs"
  | "missing-threads"
  | "missing-workspace"
  | "tabs-state-unavailable"
  | "threads-state-unavailable"
  | "workspace-state-unavailable";

/** Resolves the retained `(workspace) → (tabs) → (threads)` state by exact names. */
export function workspaceThreadsRouteState(
  root: NavigationState | undefined,
): WorkspaceThreadsRouteStateResult {
  const workspace = requiredRouteState(findUniqueRouteDeep(root, "(workspace)"), {
    duplicate: "duplicate-workspace",
    missing: "missing-workspace",
    stateUnavailable: "workspace-state-unavailable",
  });
  if (workspace.status === "unavailable") {
    return workspace;
  }
  const tabs = requiredRouteState(findUniqueDirectRoute(workspace.state, "(tabs)"), {
    duplicate: "duplicate-tabs",
    missing: "missing-tabs",
    stateUnavailable: "tabs-state-unavailable",
  });
  if (tabs.status === "unavailable") {
    return tabs;
  }
  return requiredRouteState(findUniqueDirectRoute(tabs.state, "(threads)"), {
    duplicate: "duplicate-threads",
    missing: "missing-threads",
    stateUnavailable: "threads-state-unavailable",
  });
}

/** Resolves the retained Threads catalog stack for project commands. */
export function workspaceThreadsCatalogState(
  root: NavigationState | undefined,
): WorkspaceThreadsRouteStateResult {
  const threads = workspaceThreadsRouteState(root);
  if (threads.status === "unavailable") {
    return threads;
  }
  return requiredRouteState(findUniqueDirectRoute(threads.state, "(lists)"), {
    duplicate: "duplicate-lists",
    missing: "missing-lists",
    stateUnavailable: "lists-state-unavailable",
  });
}

/** Reads Search identity from the retained Threads active chain, deepest route first. */
export function workspaceThreadsSearchSessionId(root: NavigationState | undefined): string | null {
  const threads = workspaceThreadsRouteState(root);
  return threads.status === "ready" ? activeSearchSessionId(threads.state) : null;
}

/** Subscribes only to the retained Search identity needed by the workspace lease owner. */
export function useWorkspaceThreadsSearchSessionId(): string | null {
  const navigation = useNavigationContainerRef();
  const subscribe = useEvent((onChange: () => void) => navigation.addListener("state", onChange));
  const snapshot = useEvent(() =>
    navigation.isReady() ? workspaceThreadsSearchSessionId(navigation.getRootState()) : null,
  );
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

function activeSearchSessionId(state: WorkspaceRouteState): string | null {
  const active = state.routes[state.index ?? 0];
  if (active === undefined) {
    return null;
  }
  const nested = nestedActiveSearchSessionId(active.state);
  if (nested !== null) {
    return nested;
  }
  return searchSessionIdParam(active.params);
}

function nestedActiveSearchSessionId(state: WorkspaceRouteState | undefined): string | null {
  return state === undefined ? null : activeSearchSessionId(state);
}

function searchSessionIdParam(
  params: WorkspaceRouteState["routes"][number]["params"],
): string | null {
  if (params === undefined || !("globalSearchSessionId" in params)) {
    return null;
  }
  const raw = params.globalSearchSessionId;
  if (typeof raw !== "string") {
    return null;
  }
  const parsed = routeSessionIdParam(raw);
  return parsed.status === "valid" ? parsed.value.value : null;
}

type RequiredRouteReasons = {
  readonly duplicate: WorkspaceThreadsUnavailableReason;
  readonly missing: WorkspaceThreadsUnavailableReason;
  readonly stateUnavailable: WorkspaceThreadsUnavailableReason;
};

function requiredRouteState(
  lookup: WorkspaceRouteLookup,
  reasons: RequiredRouteReasons,
): WorkspaceThreadsRouteStateResult {
  if (lookup.status === "duplicate") {
    return { reason: reasons.duplicate, status: "unavailable" };
  }
  if (lookup.status === "missing") {
    return { reason: reasons.missing, status: "unavailable" };
  }
  if (lookup.route.state === undefined) {
    return { reason: reasons.stateUnavailable, status: "unavailable" };
  }
  return { state: lookup.route.state, status: "ready" };
}
