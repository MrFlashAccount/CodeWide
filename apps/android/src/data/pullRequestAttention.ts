import { observable } from "@legendapp/state";

import type { AttentionRevision, PullRequestKey } from "./forgeContract";

/**
 * Revisions displayed by this process. The durable authority remains the
 * Companion; this projection only removes the dot without regrouping the
 * currently visible list underneath the user's pointer.
 */
export const displayedPullRequestAttention = observable<Record<string, AttentionRevision>>({});

/** Records that one exact PR revision reached a committed detail screen. */
export function notePullRequestAttentionDisplayed(
  pullRequest: PullRequestKey,
  revision: AttentionRevision,
): void {
  displayedPullRequestAttention[pullRequest]?.set(revision);
}
