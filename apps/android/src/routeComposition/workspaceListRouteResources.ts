import { createContext, useContext, type ComponentProps } from "react";

import type { WorkspaceRouteThreadList } from "./WorkspaceRouteThreadList";

type WorkspaceListRouteResources = ComponentProps<typeof WorkspaceRouteThreadList>;

/** Shares catalog capabilities without making the mounted shell own list destinations. */
export const WorkspaceListRouteContext = createContext<WorkspaceListRouteResources | null>(null);

/** Reads the existing catalog and actions for one Router-owned list screen. */
export function useWorkspaceListRouteResources(): WorkspaceListRouteResources {
  const resources = useContext(WorkspaceListRouteContext);
  if (resources === null) {
    throw new Error("List route is outside the workspace catalog boundary");
  }
  return resources;
}
