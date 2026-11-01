/**
 * Process-lifetime forge and review read models bound to the existing V1
 * session authority. Constructed once at module evaluation, like the other
 * runtime owners; feature adapters and route composition consume them.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";

import { appLogger } from "../observability/logger";
import { configureForgeQueryConnectivity } from "./forgeQueryConnectivity";
import { createForgeResources } from "./forgeResources";
import { forgeSnapshotCache } from "./forgeSnapshotCache";
import { createPullRequestCommentDestinations } from "./pullRequestCommentDestinations";
import { createPullRequestLinkResources } from "./pullRequestLinkResources";
import { createReviewResources } from "./reviewResources";
import { rpcAfterAttach, workspaceRuntime } from "./workspace-runtime";

const QUERY_CACHE_WRITE_THROTTLE_MS = 1000;
const getSession = (connectionId: string) => workspaceRuntime.supervisor?.session(connectionId);

configureForgeQueryConnectivity();

/** Reports a catalog descriptor dropped by the contract; only its opaque id is logged. */
export function reportDroppedForgeAction(actionId: string): void {
  appLogger.warn({ event: "forge.action.dropped", fields: { actionId } });
}

/** Forge accounts, PR lists, overviews, files and activity. */
export const forgeResources = createForgeResources({
  getSession,
  persister: createAsyncStoragePersister({
    key: "CODEWIDE_FORGE_QUERY_CACHE_V1",
    storage: AsyncStorage,
    throttleTime: QUERY_CACHE_WRITE_THROTTLE_MS,
  }),
  reportDroppedAction: reportDroppedForgeAction,
  rpcAfterAttach,
});

/** Drafts, guides and hunk catalogs keyed by diff source. */
export const reviewResources = createReviewResources({
  getSession,
  queryClient: forgeResources.queryClient,
  rpcAfterAttach,
});

/** PR badges of visible thread rows. */
export const pullRequestLinkResources = createPullRequestLinkResources({
  getSession,
  rpcAfterAttach,
});

/** Last comment destination per PR on this device. */
export const pullRequestCommentDestinations =
  createPullRequestCommentDestinations(forgeSnapshotCache);
