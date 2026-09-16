import { createContext, useContext } from "react";
import type { StoredConnection } from "../../data/connection-profile-types";
import type { PendingServerRequest } from "../../data/pending-request-types";
import type { WorkspaceRuntimeSnapshot } from "../../data/workspace-runtime";
import type { useConnectionActions } from "../../features/connections/connectionActions";
import type { useRenderRecovery } from "../../features/diagnostics/renderRecovery";
import type { BrowserFeedbackCapability } from "../../features/ports/browser/feedback";
import type { useThreadListActions } from "../../features/threadList/threadListActions";
import type { ThreadListSources } from "../../features/threadList/threadListSources";
import type { useWorkspaceListBindings } from "../../features/workspace/workspaceListBindings";
import type { useWorkspaceProjectBindings } from "../../features/workspace/workspaceProjectBindings";
import type { EdgeInsets } from "react-native-safe-area-context";

/** Mounted runtime and feature resources shared by nested V1 route organisms. */
export type WorkspaceRouteResources = {
  readonly browserFeedback: Omit<BrowserFeedbackCapability, "initialDestination">;
  readonly connectionActions: ReturnType<typeof useConnectionActions>;
  readonly connections: StoredConnection[];
  readonly desktop: boolean;
  readonly insets: EdgeInsets;
  readonly list: ReturnType<typeof useWorkspaceListBindings>;
  readonly listActions: ReturnType<typeof useThreadListActions>;
  readonly openBrowser: (title: string, url: string) => void;
  readonly openNewThread: (connectionId: string, cwd: string | null) => void;
  readonly pendingRequests: PendingServerRequest[];
  readonly project: ReturnType<typeof useWorkspaceProjectBindings>;
  readonly recovery: ReturnType<typeof useRenderRecovery>;
  readonly runtime: WorkspaceRuntimeSnapshot;
  readonly threadListSources: ThreadListSources;
  readonly viewportWidth: number;
};

/** Carries one mounted V1 workspace's route-qualified resources to its route organisms. */
export const WorkspaceRouteResourcesContext = createContext<WorkspaceRouteResources | null>(null);

/** Reads the mounted V1 workspace resources or fails inside a misplaced route. */
export function useWorkspaceRouteResources(): WorkspaceRouteResources {
  const resources = useContext(WorkspaceRouteResourcesContext);
  if (resources === null) {
    throw new Error("V1 route is outside the workspace resource boundary");
  }
  return resources;
}
