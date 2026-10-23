import { useRouter } from "expo-router";

import type { PullRequestKey } from "../data/forgeContract";
import { useEvent } from "../react/useEvent";
import { threadSelectionKey } from "../services/threads/threadRouteParams";

/** Catalog shown by the bottom bar. */
export type CatalogRouteMode = "pullRequests" | "threads";

/**
 * Pull-request navigation intents. Opening a PR publishes the destination
 * immediately so its detail-pane skeleton owns loading feedback. Switching
 * catalogs replaces `/` and `/pulls` without a history entry.
 */
export function usePullRequestNavigation(): {
  readonly openPullRequest: (connectionId: string, pullRequest: PullRequestKey) => void;
  readonly switchCatalog: (mode: CatalogRouteMode) => void;
} {
  const router = useRouter();
  const openPullRequest = useEvent((connectionId: string, pullRequest: PullRequestKey): void => {
    router.push({
      params: { connectionId, pullRequestKey: pullRequest },
      pathname: "/pulls/[connectionId]/[pullRequestKey]",
    });
  });
  const switchCatalog = useEvent((mode: CatalogRouteMode): void => {
    router.replace(mode === "pullRequests" ? "/pulls" : "/");
  });
  return { openPullRequest, switchCatalog };
}

/** Opens a linked thread from the PR screen through the existing thread navigation. */
export function linkedThreadSelectionKey(connectionId: string, threadId: string): string {
  return threadSelectionKey({ id: threadId, serverId: connectionId });
}
