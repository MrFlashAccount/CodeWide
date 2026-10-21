/**
 * Process-lifetime forge and review read models bound to the existing V1
 * session authority. Constructed once at module evaluation, like the other
 * runtime owners; feature adapters and route composition consume them.
 */
import { appLogger } from "../observability/logger";
import { createForgeResources } from "./forgeResources";
import { forgeSnapshotCache } from "./forgeSnapshotCache";
import { createPullRequestCommentDestinations } from "./pullRequestCommentDestinations";
import { createPullRequestLinkResources } from "./pullRequestLinkResources";
import { createReviewResources } from "./reviewResources";
import { rpcAfterAttach, workspaceRuntime } from "./workspace-runtime";

const getSession = (connectionId: string) => workspaceRuntime.supervisor?.session(connectionId);

/** Reports a catalog descriptor dropped by the contract; only its opaque id is logged. */
export function reportDroppedForgeAction(actionId: string): void {
  appLogger.warn({ event: "forge.action.dropped", fields: { actionId } });
}

/** Forge accounts, PR lists, overviews, files and activity. */
export const forgeResources = createForgeResources({
  getSession,
  reportDroppedAction: reportDroppedForgeAction,
  rpcAfterAttach,
  snapshots: forgeSnapshotCache,
});

/** Drafts, guides and hunk catalogs keyed by diff source. */
export const reviewResources = createReviewResources({ getSession, rpcAfterAttach });

/** PR badges of visible thread rows. */
export const pullRequestLinkResources = createPullRequestLinkResources({
  getSession,
  rpcAfterAttach,
});

/** Last comment destination per PR on this device. */
export const pullRequestCommentDestinations =
  createPullRequestCommentDestinations(forgeSnapshotCache);
