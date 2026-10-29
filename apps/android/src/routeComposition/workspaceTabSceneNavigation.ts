import { createContext, useContext } from "react";

import type { CatalogMode } from "../features/pullRequests/CatalogModeBar";

/** Parent-tab action exposed to retained child scenes without leaking the navigation object. */
export type WorkspaceTabsActivation = {
  readonly activate: (mode: CatalogMode) => void;
};

/** Active-scene capability consumed by one catalog master. */
export type WorkspaceTabSceneNavigation = WorkspaceTabsActivation & {
  readonly tabActive: boolean;
};

/** Internal parent capability channel populated by the real Tabs layout. */
export const WorkspaceTabsNavigationContext = createContext<WorkspaceTabsActivation | null>(null);

/** Internal scene capability channel consumed by catalog masters. */
export const WorkspaceTabSceneNavigationContext = createContext<WorkspaceTabSceneNavigation | null>(
  null,
);

/** Reads the active-scene capability without exposing parent navigation state. */
export function useWorkspaceTabSceneNavigation(): WorkspaceTabSceneNavigation {
  const value = useContext(WorkspaceTabSceneNavigationContext);
  if (value === null) {
    throw new Error("Workspace catalog master must be rendered inside a workspace tab scene");
  }
  return value;
}

/** Reads the parent action while constructing one scene-specific capability. */
export function useWorkspaceTabsNavigation(): WorkspaceTabsActivation {
  const value = useContext(WorkspaceTabsNavigationContext);
  if (value === null) {
    throw new Error("Workspace tab scene must be rendered inside WorkspaceTabsRouteLayout");
  }
  return value;
}
