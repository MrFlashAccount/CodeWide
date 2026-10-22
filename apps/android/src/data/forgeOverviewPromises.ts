/**
 * Promise owner of the atomic PR overview. One cached Promise per PR serves
 * both navigation preload and the screen's Suspense read; background refreshes
 * publish into `state$` without replacing the Promise the screen already used.
 */
import { observable, type Observable } from "@legendapp/state";

import type { PullRequestKey } from "./forgeContract";
import { classifyForgeError, ForgeContractViolation } from "./forgeErrors";
import { parsePullRequestOverview, type PullRequestOverview } from "./forgePullRequestContract";
import { OVERVIEW_SNAPSHOT_PREFIX, type ForgeSnapshotCache } from "./forgeSnapshotCache.types";
import { loadingFrom, remoteValue, type RemoteValue } from "./forgeRemoteValue";
import { observablePromise } from "./observablePromise";

/** Identity of one PR on one connection. */
export type OverviewParams = {
  readonly connectionId: string;
  readonly pullRequest: PullRequestKey;
};

/** Overview Promise cache plus its progressive refresh state. */
export type OverviewPromises = {
  /** Key of one PR's entry in `state$`. */
  readonly keyOf: (params: OverviewParams) => string;
  /** Applies an acknowledged change, for example the catalog returned by an action run. */
  readonly patch: (
    params: OverviewParams,
    update: (current: PullRequestOverview) => PullRequestOverview,
  ) => void;
  readonly preload: (params: OverviewParams) => Promise<PullRequestOverview>;
  readonly ready$: (params: OverviewParams) => Observable<PullRequestOverview>;
  readonly refresh: (params: OverviewParams) => Promise<void>;
  /** Re-reads every cached overview of one PR. */
  readonly refreshMatching: (connectionId: string, pullRequest: PullRequestKey) => void;
  readonly state$: Observable<Record<string, RemoteValue<PullRequestOverview>>>;
};

const MAX_CACHED_OVERVIEWS = 24;

type OverviewEntry = {
  readonly promise: Promise<PullRequestOverview>;
  readonly ready$: Observable<PullRequestOverview>;
};

function snapshotKey(value: OverviewParams): string {
  return `${OVERVIEW_SNAPSHOT_PREFIX}${value.pullRequest}`;
}

function keyOf(params: OverviewParams): string {
  return `${params.connectionId}\u0000${params.pullRequest}`;
}

/** Creates the overview owner. */
export function createOverviewPromises({
  load,
  reportDroppedAction,
  snapshots,
}: {
  readonly load: (params: OverviewParams) => Promise<unknown>;
  readonly reportDroppedAction: (actionId: string) => void;
  readonly snapshots: ForgeSnapshotCache;
}): OverviewPromises {
  const state$ = observable<Record<string, RemoteValue<PullRequestOverview>>>({});
  const promises = new Map<string, OverviewEntry>();
  const params = new Map<string, OverviewParams>();
  const read = async (value: OverviewParams): Promise<PullRequestOverview> => {
    const overview = parsePullRequestOverview(await load(value), reportDroppedAction);
    if (overview === null) {
      throw new ForgeContractViolation("pull request overview");
    }
    // The snapshot is a best-effort offline copy; a failed write keeps the previous one.
    snapshots.write(value.connectionId, snapshotKey(value), overview).catch(() => undefined);
    return overview;
  };
  const readWithFallback = async (value: OverviewParams): Promise<PullRequestOverview> => {
    const key = keyOf(value);
    try {
      const overview = await read(value);
      state$[key]?.set({ refreshing: false, status: "ready", value: overview });
      return overview;
    } catch (error) {
      const failure = classifyForgeError(error);
      const cached =
        failure.kind === "unreachable"
          ? parsePullRequestOverview(
              await snapshots.read(value.connectionId, snapshotKey(value)),
              reportDroppedAction,
            )
          : null;
      if (cached === null) {
        throw error;
      }
      state$[key]?.set({ failure, status: "failed", value: cached });
      return cached;
    }
  };
  const entry = (value: OverviewParams): OverviewEntry => {
    const key = keyOf(value);
    const cached = promises.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const promise = readWithFallback(value);
    const created = { promise, ready$: observablePromise(promise) };
    promises.set(key, created);
    params.set(key, value);
    promise.catch(() => {
      // A failed preload is not cached: the next navigation retries.
      promises.delete(key);
    });
    for (const stale of [...promises.keys()].slice(
      0,
      Math.max(0, promises.size - MAX_CACHED_OVERVIEWS),
    )) {
      promises.delete(stale);
      params.delete(stale);
    }
    return created;
  };
  const refresh = async (value: OverviewParams): Promise<void> => {
    const entry$ = state$[keyOf(value)];
    if (entry$ === undefined) {
      return;
    }
    entry$.set(loadingFrom(entry$.peek()));
    try {
      entry$.set({ refreshing: false, status: "ready", value: await read(value) });
    } catch (error) {
      entry$.set({
        failure: classifyForgeError(error),
        status: "failed",
        value: remoteValue(entry$.peek()),
      });
    }
  };
  return {
    keyOf,
    patch(value, update) {
      const current = state$[keyOf(value)]?.peek();
      if (current !== undefined && current.status !== "idle" && current.value !== null) {
        state$[keyOf(value)]?.set({
          refreshing: false,
          status: "ready",
          value: update(current.value),
        });
      }
    },
    preload: async (value) => entry(value).promise,
    // The same entry serves preload and Suspense, so both read one Promise identity.
    ready$: (value) => entry(value).ready$,
    refresh,
    refreshMatching(connectionId, pullRequest) {
      for (const value of params.values()) {
        if (value.connectionId === connectionId && value.pullRequest === pullRequest) {
          // refresh publishes its failure into state$ and never rejects.
          refresh(value).catch(() => undefined);
        }
      }
    },
    state$,
  };
}
