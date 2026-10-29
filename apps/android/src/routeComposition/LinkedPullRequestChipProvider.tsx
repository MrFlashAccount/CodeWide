import { useSelector } from "@legendapp/state/react";
import type { ReactNode } from "react";

import type { PullRequestKey } from "../data/forgeContract";
import type { PullRequestBadge } from "../data/forgePullRequestContract";
import { pullRequestLinkResources } from "../data/forgeRuntime";
import { pullRequestBadgeKey } from "../data/pullRequestLinkResources";
import {
  ComposerLinkedPullRequestContext,
  type ComposerLinkedPullRequest,
  type ComposerLinkedPullRequests,
} from "../features/composer/composerLinkedPullRequest";
import { useEvent } from "../react/useEvent";
import { usePullRequestNavigation } from "./pullRequestNavigation";

/**
 * Supplies the composer's linked pull request chip for one mounted conversation. The links are
 * the thread-row badges (`companion/pullRequestLinks/read`, demanded during render and ordered
 * by the Companion: canonical review chat first, then the most recently linked). The pull
 * request the route already shows (`visiblePullRequest`, set by the PR route's review-chat
 * pane) is excluded, so its own review chat offers no chip back to it.
 */
export function LinkedPullRequestChipProvider({
  children,
  connectionId,
  threadId,
  visiblePullRequest,
}: {
  readonly children: ReactNode;
  readonly connectionId: string;
  readonly threadId: string;
  readonly visiblePullRequest: PullRequestKey | null;
}): React.JSX.Element {
  pullRequestLinkResources.demand(connectionId, threadId);
  const badges = useSelector(() =>
    pullRequestLinkResources.badges$[pullRequestBadgeKey(connectionId, threadId)]?.get(),
  );
  const navigation = usePullRequestNavigation();
  const open = useEvent((id: string): void => {
    const badge = badges?.find((candidate) => candidate.pullRequest === id);
    if (badge !== undefined) {
      navigation.openPullRequest(connectionId, badge.pullRequest);
    }
  });
  return (
    <ComposerLinkedPullRequestContext.Provider
      value={linkedPullRequestChip(badges ?? [], visiblePullRequest, open)}
    >
      {children}
    </ComposerLinkedPullRequestContext.Provider>
  );
}

/** Projects a thread's badges into the chip capability, or `null` when none remains to open. */
function linkedPullRequestChip(
  badges: readonly PullRequestBadge[],
  visiblePullRequest: PullRequestKey | null,
  open: (id: string) => void,
): ComposerLinkedPullRequests | null {
  const items: ComposerLinkedPullRequest[] = [];
  for (const badge of badges) {
    if (badge.pullRequest !== visiblePullRequest) {
      items.push({
        icon: badge.icon,
        id: badge.pullRequest,
        label: `#${badge.number}`,
      });
    }
  }
  const [first, ...rest] = items;
  return first === undefined ? null : { items: [first, ...rest], open };
}
