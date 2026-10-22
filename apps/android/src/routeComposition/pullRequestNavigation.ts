import { useRouter } from "expo-router";
import { startTransition, useState } from "react";

import type { PullRequestKey } from "../data/forgeContract";
import { forgeResources } from "../data/forgeRuntime";
import { useEvent } from "../react/useEvent";
import { threadSelectionKey } from "../services/threads/threadRouteParams";
import { useAppDialog } from "../ui/AppDialog";

/** Catalog shown by the bottom bar. */
export type CatalogRouteMode = "pullRequests" | "threads";

/**
 * Pull-request navigation intents. Opening a PR preloads its overview through
 * the forge resource (the same cached Promise the screen suspends on), then
 * pushes the destination inside a Transition, so the list stays visible until
 * the summary is ready. Switching catalogs replaces `/` and `/pulls` without a
 * history entry. This module owns no Promise.
 */
export function usePullRequestNavigation(): {
  readonly openingKey: PullRequestKey | null;
  readonly openPullRequest: (connectionId: string, pullRequest: PullRequestKey) => void;
  readonly switchCatalog: (mode: CatalogRouteMode) => void;
} {
  const router = useRouter();
  const dialog = useAppDialog();
  const [openingKey, setOpeningKey] = useState<PullRequestKey | null>(null);
  const openPullRequest = useEvent((connectionId: string, pullRequest: PullRequestKey): void => {
    setOpeningKey(pullRequest);
    // The header's provider mark comes from the accounts snapshot; load it with the overview.
    Promise.all([
      forgeResources.preloadOverview({ connectionId, pullRequest }),
      forgeResources.loadAccounts(connectionId),
    ])
      .then(
        () => {
          startTransition(() => {
            router.push({
              params: { connectionId, pullRequestKey: pullRequest },
              pathname: "/pulls/[connectionId]/[pullRequestKey]",
            });
          });
        },
        (error: unknown) => {
          dialog.error("Could not open the pull request", error);
        },
      )
      .finally(() => {
        setOpeningKey(null);
      });
  });
  const switchCatalog = useEvent((mode: CatalogRouteMode): void => {
    router.replace(mode === "pullRequests" ? "/pulls" : "/");
  });
  return { openingKey, openPullRequest, switchCatalog };
}

/** Opens a linked thread from the PR screen through the existing thread navigation. */
export function linkedThreadSelectionKey(connectionId: string, threadId: string): string {
  return threadSelectionKey({ id: threadId, serverId: connectionId });
}
