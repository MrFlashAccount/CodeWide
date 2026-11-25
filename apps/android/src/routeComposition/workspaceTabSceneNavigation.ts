import { createContext, useContext } from "react";
import type { SharedValue } from "react-native-reanimated";

import type { CatalogMode } from "../features/pullRequests/CatalogModeBar";

type WorkspaceTabsActivation = {
  readonly activate: (mode: CatalogMode) => void;
  readonly activeMode: CatalogMode | null;
};

/** A split frame can reuse its detail layer across a burst of catalog switches. */
export const WorkspaceTabLayerContext = createContext<SharedValue<boolean> | null>(null);

/** Router-owned focus and activation shared by the retained catalogs. */
export const WorkspaceTabsNavigationContext = createContext<WorkspaceTabsActivation | null>(null);

/** Reads the selected catalog and the standard tab activation action. */
export function useWorkspaceTabsNavigation(): WorkspaceTabsActivation {
  const value = useContext(WorkspaceTabsNavigationContext);
  if (value === null) {
    throw new Error("Workspace tab scene must be rendered inside WorkspaceTabsRouteLayout");
  }
  return value;
}
