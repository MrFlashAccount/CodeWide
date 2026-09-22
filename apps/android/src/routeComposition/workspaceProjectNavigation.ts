import { useNavigationContainerRef } from "expo-router";
import { useSyncExternalStore } from "react";

import type { NavigationState, PartialState } from "expo-router/build/react-navigation/routers";
import type { SidebarProject } from "../features/projects/sidebarProjects";
import { useEvent } from "../react/useEvent";
import { projectListRouteSessions } from "../services/projects/projectListRouteSession";
import { routeSessionIdParam } from "../services/threads/threadRouteParams";

/** Reads catalog history independently of the workspace's focused conversation or overlay. */
function workspaceCatalogState(
  state: NavigationState | undefined,
): NavigationState | PartialState<NavigationState> | undefined {
  return findWorkspaceState(state)?.routes.find((route) => route.name === "(lists)")?.state;
}

function findWorkspaceState(
  state: NavigationState | PartialState<NavigationState> | undefined,
): NavigationState | PartialState<NavigationState> | undefined {
  if (state === undefined) {
    return undefined;
  }
  for (const route of state.routes) {
    if (route.name === "(workspace)") {
      return route.state;
    }
    const nested = findWorkspaceState(route.state);
    if (nested !== undefined) {
      return nested;
    }
  }
  return undefined;
}

/** Returns the active catalog payload; detail route parameters are not a second selection owner. */
export function workspaceProjectSessionId(state: NavigationState | undefined): string | null {
  const catalog = workspaceCatalogState(state);
  if (catalog === undefined) {
    return null;
  }
  const selected = catalog.routes[catalog.index ?? 0];
  if (selected?.name !== "project/[sessionId]") {
    return null;
  }
  return projectSessionParam(selected.params);
}

function projectSessionParam(params: NavigationState["routes"][number]["params"]): string | null {
  const id = params !== undefined && "sessionId" in params ? params.sessionId : undefined;
  const parsed = routeSessionIdParam(typeof id === "string" ? id : undefined);
  return parsed.status === "valid" ? parsed.value.value : null;
}

/** Subscribes to catalog changes even when a different workspace destination stays focused. */
export function useWorkspaceProjectSessionId(): string | null {
  const navigation = useNavigationContainerRef();
  const subscribe = useEvent((onChange: () => void) => navigation.addListener("state", onChange));
  const snapshot = useEvent(() =>
    navigation.isReady() ? workspaceProjectSessionId(navigation.getRootState()) : null,
  );
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Dispatches to the existing catalog stack without focusing or replacing the selected chat. */
export function useWorkspaceProjectNavigation(sessionId: string | null): {
  readonly closeSidebarProject: () => void;
  readonly openSidebarProject: (project: SidebarProject) => void;
  readonly sidebarProject: SidebarProject | null;
} {
  const navigation = useNavigationContainerRef();
  const openSidebarProject = useEvent((project: SidebarProject): void => {
    const catalog = workspaceCatalogState(navigation.getRootState());
    if (catalog?.key === undefined) {
      throw new Error("Workspace catalog navigator is unavailable");
    }
    const session = projectListRouteSessions.open(project);
    navigation.dispatch({
      payload: { name: "project/[sessionId]", params: { sessionId: session.id } },
      target: catalog.key,
      type: (catalog.index ?? 0) === 0 ? "PUSH" : "REPLACE",
    });
  });
  const closeSidebarProject = useEvent((): void => {
    const catalog = workspaceCatalogState(navigation.getRootState());
    if (catalog?.key === undefined) {
      return;
    }
    navigation.dispatch({ target: catalog.key, type: "POP_TO_TOP" });
  });
  return {
    closeSidebarProject,
    openSidebarProject,
    sidebarProject:
      sessionId === null ? null : (projectListRouteSessions.get(sessionId)?.project ?? null),
  };
}
