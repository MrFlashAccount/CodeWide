import type { useSafeAreaInsets } from "react-native-safe-area-context";

import type { StoredConnection } from "../../data/connection-profile-types";
import type { PendingServerRequest } from "../../data/pending-request-types";
import type { WorkspaceRuntimeSnapshot } from "../../data/workspace-runtime";

/** Shared inputs consumed by the list and project bindings in workspace composition. */
export type WorkspaceBindingContext = {
  connections: StoredConnection[];
  desktop: boolean;
  insets: ReturnType<typeof useSafeAreaInsets>;
  pendingRequests: PendingServerRequest[];
  runtime: WorkspaceRuntimeSnapshot;
  viewportWidth: number;
};
