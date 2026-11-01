/**
 * Last comment destination chosen per pull request on this device. Stored in
 * the connection's forge device store, so deleting the connection's local data
 * removes it; it is a preference, never authoritative.
 */
import { observable, type Observable } from "@legendapp/state";

import type { PullRequestKey } from "./forgeContract";
import type { ForgeSnapshotCache } from "./forgeSnapshotCache.types";
import type { DraftDestination } from "./reviewDraftContract";

/** Remembered destinations keyed by connection and PR. */
export type PullRequestCommentDestinations = {
  readonly destinations$: Observable<Record<string, DraftDestination>>;
  /** Reads the stored choice once per PR; the value lands in `destinations$` after the render. */
  readonly hydrate: (connectionId: string, pullRequest: PullRequestKey) => void;
  readonly keyOf: (connectionId: string, pullRequest: PullRequestKey) => string;
  readonly remember: (
    connectionId: string,
    pullRequest: PullRequestKey,
    destination: DraftDestination,
  ) => void;
};

const DESTINATIONS: readonly DraftDestination[] = ["agent", "pr", "both"];

function destinationKey(connectionId: string, pullRequest: PullRequestKey): string {
  return `${connectionId}\u0000${pullRequest}`;
}

function storeKey(pullRequest: PullRequestKey): string {
  return `comment-destination\u0000${pullRequest}`;
}

/** Creates the per-PR destination memory over the forge device store. */
export function createPullRequestCommentDestinations(
  store: ForgeSnapshotCache,
): PullRequestCommentDestinations {
  const destinations$ = observable<Record<string, DraftDestination>>({});
  const hydrated = new Set<string>();
  return {
    destinations$,
    hydrate(connectionId, pullRequest) {
      const key = destinationKey(connectionId, pullRequest);
      if (hydrated.has(key)) {
        return;
      }
      hydrated.add(key);
      store
        .read(connectionId, storeKey(pullRequest))
        .then((value) => {
          const destination = DESTINATIONS.find((candidate) => candidate === value);
          if (destination !== undefined && destinations$[key]?.peek() === undefined) {
            destinations$[key]?.set(destination);
          }
        })
        // A missing or unreadable choice falls back to the default destination.
        .catch(() => undefined);
    },
    keyOf: destinationKey,
    remember(connectionId, pullRequest, destination) {
      destinations$[destinationKey(connectionId, pullRequest)]?.set(destination);
      // The in-memory choice already applies; a failed write only loses it across restarts.
      store.write(connectionId, storeKey(pullRequest), destination).catch(() => undefined);
    },
  };
}
