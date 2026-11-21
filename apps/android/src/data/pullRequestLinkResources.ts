/**
 * PR badges for thread rows. Visible rows demand their thread ids during
 * render; demands are batched per connection (at most 200 ids per request, the
 * Companion limit) and read once per thread until a forge invalidation clears
 * them. An older Companion without forge methods simply yields no badges.
 */
import { observable, type Observable } from "@legendapp/state";
import type { RpcClient } from "@codewide/sync-client";

import { forgeInvalidationBus } from "./forgeInvalidationBus";
import { parsePullRequestLinks, type PullRequestBadge } from "./forgePullRequestContract";
import type { createWorkspaceSession } from "./workspace-session";

const MAX_THREAD_IDS_PER_READ = 200;
const NO_BADGES: readonly PullRequestBadge[] = [];

/** Badge read model keyed by `connectionId\0threadId`. */
export type PullRequestLinkResources = {
  readonly badges$: Observable<Record<string, readonly PullRequestBadge[]>>;
  /** Records that a visible row wants badges; the read starts after the current render. */
  readonly demand: (connectionId: string, threadId: string) => void;
};

/** Stable key of one thread's badges. */
export function pullRequestBadgeKey(connectionId: string, threadId: string): string {
  return `${connectionId}\u0000${threadId}`;
}

/** Builds the batched badge reader. */
export function createPullRequestLinkResources({
  getSession,
  rpcAfterAttach,
}: {
  readonly getSession: (connectionId: string) => RpcClient | undefined;
  readonly rpcAfterAttach: ReturnType<typeof createWorkspaceSession>["rpcAfterAttach"];
}): PullRequestLinkResources {
  const badges$ = observable<Record<string, readonly PullRequestBadge[]>>({});
  const requested = new Set<string>();
  const queued = new Map<string, Set<string>>();
  const unsupported = new Set<string>();
  let scheduled = false;
  const flush = async (connectionId: string, threadIds: readonly string[]): Promise<void> => {
    const session = getSession(connectionId);
    if (session === undefined || unsupported.has(connectionId)) {
      return;
    }
    try {
      const result = parsePullRequestLinks(
        await rpcAfterAttach<unknown>(session, "companion/pullRequestLinks/read", { threadIds }),
      );
      for (const threadId of threadIds) {
        badges$[pullRequestBadgeKey(connectionId, threadId)]?.set(result?.[threadId] ?? NO_BADGES);
      }
    } catch {
      // Badges are optional decoration: an older or unreachable companion shows none.
      unsupported.add(connectionId);
    }
  };
  const drain = (): void => {
    scheduled = false;
    for (const [connectionId, ids] of queued) {
      const all = [...ids];
      for (let start = 0; start < all.length; start += MAX_THREAD_IDS_PER_READ) {
        // flush handles its own failure (no badges); nothing can reject here.
        flush(connectionId, all.slice(start, start + MAX_THREAD_IDS_PER_READ)).catch(
          () => undefined,
        );
      }
    }
    queued.clear();
  };
  const enqueue = (connectionId: string, threadId: string): void => {
    let ids = queued.get(connectionId);
    if (ids === undefined) {
      ids = new Set();
      queued.set(connectionId, ids);
    }
    ids.add(threadId);
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(drain);
    }
  };
  forgeInvalidationBus.subscribe((connectionId, invalidation) => {
    if (invalidation.scope === "review") {
      return;
    }
    // Links change with accounts, lists and single PRs; re-read every badge already shown.
    unsupported.delete(connectionId);
    const prefix = `${connectionId}\u0000`;
    for (const key of requested) {
      if (key.startsWith(prefix)) {
        enqueue(connectionId, key.slice(prefix.length));
      }
    }
  });
  return {
    badges$,
    demand(connectionId, threadId) {
      const key = pullRequestBadgeKey(connectionId, threadId);
      if (requested.has(key) || unsupported.has(connectionId)) {
        return;
      }
      requested.add(key);
      enqueue(connectionId, threadId);
    },
  };
}
