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

/**
 * Supplies the composer's linked pull request chip for one mounted conversation. The links are
 * the thread-row badges (`companion/pullRequestLinks/read`, demanded during render and ordered
 * by the Companion: canonical review chat first, then the most recently linked). The pull
 * request the route already shows (`visiblePullRequest`: the PR route's own pull request beside
 * its review chat, or the pull request a thread shows in its side pane) is excluded, so the chip
 * never offers what is already on screen. The mounting route decides where `onOpen` opens it.
 */
export function LinkedPullRequestChipProvider({
  children,
  connectionId,
  onOpen,
  threadId,
  visiblePullRequest,
}: {
  readonly children: ReactNode;
  readonly connectionId: string;
  /** Opens the chosen linked pull request through the mounting route's navigation. */
  readonly onOpen: (pullRequest: PullRequestKey) => void;
  readonly threadId: string;
  readonly visiblePullRequest: PullRequestKey | null;
}): React.JSX.Element {
  pullRequestLinkResources.demand(connectionId, threadId);
  const badges = useSelector(() =>
    pullRequestLinkResources.badges$[pullRequestBadgeKey(connectionId, threadId)]?.get(),
  );
  const open = useEvent((id: string): void => {
    const badge = badges?.find((candidate) => candidate.pullRequest === id);
    if (badge !== undefined) {
      onOpen(badge.pullRequest);
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
