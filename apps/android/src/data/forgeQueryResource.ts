/**
 * TanStack Query-backed server resource. Query owns request identity, stale
 * data, retries, active polling and garbage collection; callers own domain
 * parsing and pagination. Persisted stale data is restored by the shared
 * QueryClient rather than by a parallel feature cache.
 */
import { type QueryClient, type QueryKey, useQuery } from "@tanstack/react-query";

import { classifyForgeError } from "./forgeErrors";
import type { RemoteValue } from "./forgeRemoteValue";

const ACTIVE_RESYNC_INTERVAL_MS = 60_000;
const CACHE_RETENTION_MS = 600_000;
const MAX_RETRIES = 3;
const RETRY_BACKOFF_FACTOR = 2;
const RETRY_BASE_DELAY_MS = 250;
const RETRY_MAX_DELAY_MS = 2000;
const STALE_AFTER_MS = 15_000;

/** Query options shared by hooks, route preloads and imperative refreshes. */
type ForgeQueryOptions<Value> = {
  readonly gcTime: number;
  readonly queryFn: () => Promise<Value>;
  readonly queryKey: QueryKey;
  readonly refetchInterval: number | false;
  readonly refetchIntervalInBackground: false;
  readonly retry: false;
  readonly staleTime: number;
};

/** How long a resource's data stays current and whether an active screen re-reads it. */
type Freshness = {
  readonly refetchInterval: number | false;
  readonly staleTime: number;
};

/** Live server state: stale after a short window and re-read while shown. */
const POLLED: Freshness = {
  refetchInterval: ACTIVE_RESYNC_INTERVAL_MS,
  staleTime: STALE_AFTER_MS,
};

/** Data addressed by an immutable revision: read once, never polled. */
const IMMUTABLE: Freshness = {
  refetchInterval: false,
  staleTime: Number.POSITIVE_INFINITY,
};

/** One keyed server resource backed only by a TanStack Query cache. */
export type ForgeQueryResource<Params, Value> = {
  readonly client: QueryClient;
  readonly data: (params: Params) => Value | null;
  readonly invalidate: (params: Params) => Promise<void>;
  readonly keyOf: (params: Params) => QueryKey;
  readonly options: (params: Params) => ForgeQueryOptions<Value>;
  readonly patch: (params: Params, update: (current: Value) => Value) => void;
  readonly preload: (params: Params) => Promise<Value>;
  readonly publish: (params: Params, value: Value) => void;
  readonly refresh: (params: Params) => Promise<void>;
};

/** Construction contract of {@link createForgeQueryResource}. */
export type ForgeQueryResourceOptions<Params, Value> = {
  readonly client: QueryClient;
  readonly keyOf: (params: Params) => QueryKey;
  readonly load: (params: Params) => Promise<Value>;
};

/** Creates one process-owned query resource of live server state. */
export function createForgeQueryResource<Params, Value>(
  resource: ForgeQueryResourceOptions<Params, Value>,
): ForgeQueryResource<Params, Value> {
  return createResource(resource, POLLED);
}

/**
 * Creates one process-owned query resource whose key names an immutable
 * revision (for example a file at a head commit): it is read once per key and
 * never re-read while shown.
 */
export function createImmutableForgeQueryResource<Params, Value>(
  resource: ForgeQueryResourceOptions<Params, Value>,
): ForgeQueryResource<Params, Value> {
  return createResource(resource, IMMUTABLE);
}

function createResource<Params, Value>(
  resource: ForgeQueryResourceOptions<Params, Value>,
  freshness: Freshness,
): ForgeQueryResource<Params, Value> {
  const options = (params: Params): ForgeQueryOptions<Value> => ({
    gcTime: CACHE_RETENTION_MS,
    queryFn: async () => loadWithRetry(resource.load, params),
    queryKey: resource.keyOf(params),
    refetchInterval: freshness.refetchInterval,
    refetchIntervalInBackground: false,
    // The resource retries only unreachable reads so semantic failures are immediate.
    retry: false,
    staleTime: freshness.staleTime,
  });
  const snapshot = (params: Params): Value | undefined =>
    resource.client.getQueryData<Value>(resource.keyOf(params));
  const execute = async (params: Params, staleTime: number | "static"): Promise<Value> => {
    const query = options(params);
    return resource.client.query({
      gcTime: query.gcTime,
      queryFn: query.queryFn,
      queryKey: query.queryKey,
      retry: query.retry,
      staleTime,
    });
  };
  return {
    client: resource.client,
    data: (params) => snapshot(params) ?? null,
    async invalidate(params) {
      await resource.client.invalidateQueries({ exact: true, queryKey: resource.keyOf(params) });
    },
    keyOf: resource.keyOf,
    options,
    patch(params, update) {
      resource.client.setQueryData<Value>(resource.keyOf(params), (current) =>
        current === undefined ? undefined : update(current),
      );
    },
    async preload(params) {
      return execute(params, "static");
    },
    publish(params, value) {
      resource.client.setQueryData(resource.keyOf(params), value);
    },
    async refresh(params) {
      await execute(params, 0);
    },
  };
}

async function loadWithRetry<Params, Value>(
  load: (params: Params) => Promise<Value>,
  params: Params,
): Promise<Value> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await load(params);
    } catch (error) {
      if (attempt >= MAX_RETRIES || classifyForgeError(error).kind !== "unreachable") {
        throw error;
      }
      await wait(
        Math.min(RETRY_BASE_DELAY_MS * RETRY_BACKOFF_FACTOR ** attempt, RETRY_MAX_DELAY_MS),
      );
    }
  }
}

async function wait(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

/** Projects a TanStack Query result into the existing progressive view contract. */
export function forgeQueryRemoteValue<Value>({
  data,
  error,
  isFetching,
}: {
  readonly data: Value | undefined;
  readonly error: Error | null;
  readonly isFetching: boolean;
}): RemoteValue<Value> {
  if (data !== undefined) {
    if (error !== null) {
      return { failure: classifyForgeError(error), status: "failed", value: data };
    }
    return { refreshing: isFetching, status: "ready", value: data };
  }
  return error === null
    ? { status: "loading", value: null }
    : { failure: classifyForgeError(error), status: "failed", value: null };
}

/** Reads one resource through its process-owned QueryClient. */
export function useForgeQuery<Params, Value>(
  resource: ForgeQueryResource<Params, Value>,
  params: Params,
): RemoteValue<Value> {
  return forgeQueryRemoteValue(useQuery(resource.options(params), resource.client));
}
