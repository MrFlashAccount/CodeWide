import { useRouter } from "expo-router";

import type { PullRequestKey } from "../data/forgeContract";
import type { ThreadId } from "../data/reviewContract";
import { useEvent } from "../react/useEvent";
import { threadSelectionKey } from "../services/threads/threadRouteParams";

/**
 * Pull-request navigation intents. Opening a PR publishes the destination
 * immediately so its detail-pane skeleton owns loading feedback. The owning
 * Router owns the PR push and canonical compact-thread navigation; this hook
 * never reconstructs, resets or mirrors either subtree.
 */
export function usePullRequestNavigation(): {
  readonly navigateToLinkedThread: (connectionId: string, threadId: ThreadId) => void;
  readonly openPullRequest: (connectionId: string, pullRequest: PullRequestKey) => void;
} {
  const router = useRouter();
  const openPullRequest = useEvent((connectionId: string, pullRequest: PullRequestKey): void => {
    router.push({
      params: { connectionId, pullRequestKey: pullRequest },
      pathname: "/pulls/[connectionId]/[pullRequestKey]",
    });
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
