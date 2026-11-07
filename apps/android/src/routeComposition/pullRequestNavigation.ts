import { usePathname, useRouter } from "expo-router";

import type { PullRequestKey } from "../data/forgeContract";
import type { ThreadId } from "../data/reviewContract";
import { useEvent } from "../react/useEvent";
import { threadSelectionKey } from "../services/threads/threadRouteParams";

/**
 * Pull-request navigation intents. Opening a PR publishes the destination
 * immediately so its detail-pane skeleton owns loading feedback. From the
 * catalog it pushes the PR; while a PR (or its Changes) is already shown it
 * dismisses to the new one instead, exactly like thread selection, so Back
 * returns to the catalog rather than through every PR opened before. The
 * owning Router owns canonical compact-thread navigation; this hook never
 * reconstructs, resets or mirrors either subtree.
 */
export function usePullRequestNavigation(): {
  readonly navigateToLinkedThread: (connectionId: string, threadId: ThreadId) => void;
  readonly openPullRequest: (connectionId: string, pullRequest: PullRequestKey) => void;
} {
  const router = useRouter();
  const pathname = usePathname();
  const openPullRequest = useEvent((connectionId: string, pullRequest: PullRequestKey): void => {
    const href = {
      params: { connectionId, pullRequestKey: pullRequest },
      pathname: "/pulls/[connectionId]/[pullRequestKey]",
    } as const;
    if (pathname.startsWith("/pulls/")) {
      router.dismissTo(href);
    } else {
      router.push(href);
    }
  });
  const navigateToLinkedThread = useEvent((connectionId: string, threadId: ThreadId): void => {
    router.navigate({
      params: { connectionId, threadId },
      pathname: "/threads/[connectionId]/[threadId]",
    });
  });
  return { navigateToLinkedThread, openPullRequest };
}

/** Produces the existing preparation key before compact canonical tab navigation. */
export function linkedThreadSelectionKey(connectionId: string, threadId: string): string {
  return threadSelectionKey({ id: threadId, serverId: connectionId });
}
