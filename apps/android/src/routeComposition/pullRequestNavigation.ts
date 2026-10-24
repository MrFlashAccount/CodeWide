import { useRouter } from "expo-router";

import type { PullRequestKey } from "../data/forgeContract";
import { useEvent } from "../react/useEvent";
import { threadSelectionKey } from "../services/threads/threadRouteParams";

/**
 * Pull-request navigation intents. Opening a PR publishes the destination
 * immediately so its detail-pane skeleton owns loading feedback. The owning
 * workspace layout resets catalog roots; this hook never mutates that stack.
 */
export function usePullRequestNavigation(): {
  readonly openPullRequest: (connectionId: string, pullRequest: PullRequestKey) => void;
} {
  const router = useRouter();
  const openPullRequest = useEvent((connectionId: string, pullRequest: PullRequestKey): void => {
    router.push({
      params: { connectionId, pullRequestKey: pullRequest },
      pathname: "/pulls/[connectionId]/[pullRequestKey]",
    });
  });
  return { openPullRequest };
}

/** Opens a linked thread from the PR screen through the existing thread navigation. */
export function linkedThreadSelectionKey(connectionId: string, threadId: string): string {
  return threadSelectionKey({ id: threadId, serverId: connectionId });
}
