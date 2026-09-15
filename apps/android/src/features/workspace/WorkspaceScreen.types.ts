import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { StoredConnection } from "../../data/connection-profile-types";
import type { PendingServerRequest } from "../../data/pending-request-types";
import { type WorkspaceRuntimeSnapshot } from "../../data/workspace-runtime";
import { type ThreadNavigationModel } from "../navigation/threadNavigation";

/** Root composition inputs retain references to the existing runtime read owners. */
export type WorkspaceContentProps = {
  desktop: boolean;
  viewportWidth: number;
  insets: ReturnType<typeof useSafeAreaInsets>;
  runtime: WorkspaceRuntimeSnapshot;
  connections: StoredConnection[];
  pendingRequests: PendingServerRequest[];
  threadNavigation: ThreadNavigationModel;
};
