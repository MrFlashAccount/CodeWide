/**
 * Model-owned keyed resource with request deduplication and Legend-owned
 * progressive snapshots. Render reads `state$`; `ensure` is idempotent and may
 * be called during render because it only starts a deduplicated load once.
 */
import { observable, type Observable } from "@legendapp/state";

import { classifyForgeError, type ForgeFailure } from "./forgeErrors";
import { loadingFrom, remoteValue, type RemoteValue } from "./forgeRemoteValue";

/** One keyed progressive resource. */
export type KeyedResource<Params, Value> = {
  /** Starts the first load for `params` when nothing is published yet. */
  readonly ensure: (params: Params) => void;
  /** Stable key of `params`. */
  readonly keyOf: (params: Params) => string;
  /** Params of every key that has been demanded, for invalidation fan-out. */
  readonly loaded: () => Iterable<Params>;
  /** Publishes an acknowledged value (for example a mutation result) without a read. */
  readonly publish: (params: Params, value: Value) => void;
  /** Re-reads `params`; concurrent calls share one request. Never rejects. */
  readonly refresh: (params: Params) => Promise<void>;
  /** Starts `refresh` without awaiting it; its outcome lands in `state$`. */
  readonly revalidate: (params: Params) => void;
  readonly state$: Observable<Record<string, RemoteValue<Value>>>;
};

/** Options of {@link createKeyedResource}. */
export type KeyedResourceOptions<Params, Value> = {
  /** Optional offline fallback read when a load fails and nothing is published. */
  readonly fallback?: (params: Params, failure: ForgeFailure) => Promise<Value | null>;
  readonly keyOf: (params: Params) => string;
  readonly load: (params: Params) => Promise<Value>;
  /** Called with every value read from the companion, for example to persist a snapshot. */
  readonly onLoaded?: (params: Params, value: Value) => void;
};

/** Creates one keyed resource; the caller owns its lifetime (process lifetime by default). */
export function createKeyedResource<Params, Value>(
  options: KeyedResourceOptions<Params, Value>,
): KeyedResource<Params, Value> {
  const state$ = observable<Record<string, RemoteValue<Value>>>({});
  const demanded = new Map<string, Params>();
  const inFlight = new Map<string, Promise<void>>();
  const put = (key: string, value: RemoteValue<Value>): void => {
    state$[key]?.set(value);
  };
  const read = async (key: string, params: Params): Promise<void> => {
    const previous = state$[key]?.peek();
    put(key, loadingFrom(previous));
    try {
      const value = await options.load(params);
      put(key, { refreshing: false, status: "ready", value });
      options.onLoaded?.(params, value);
    } catch (error) {
      const failure = classifyForgeError(error);
      put(key, { failure, status: "failed", value: await failedValue(params, previous, failure) });
    }
  };
  const failedValue = async (
    params: Params,
    previous: RemoteValue<Value> | undefined,
    failure: ForgeFailure,
  ): Promise<Value | null> => {
    const published = remoteValue(previous);
    if (published !== null || options.fallback === undefined) {
      return published;
    }
    return options.fallback(params, failure).catch(() => null);
  };
  const refresh = async (params: Params): Promise<void> => {
    const key = options.keyOf(params);
    demanded.set(key, params);
    const pending = inFlight.get(key);
    if (pending !== undefined) {
      return pending;
    }
    const operation = read(key, params).finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, operation);
    return operation;
  };
  const revalidate = (params: Params): void => {
    refresh(params).catch(settledIntoState);
  };
  return {
    ensure(params) {
      const key = options.keyOf(params);
      if (demanded.has(key)) {
        return;
      }
      demanded.set(key, params);
      // A render-time demand must not publish during that render; the load starts after it.
      // The load settles into state$ and never rejects.
      queueMicrotask(() => {
        revalidate(params);
      });
    },
    keyOf: options.keyOf,
    loaded: () => demanded.values(),
    publish(params, value) {
      const key = options.keyOf(params);
      demanded.set(key, params);
      put(key, { refreshing: false, status: "ready", value });
    },
    refresh,
    revalidate,
    state$,
  };
}

/** `refresh` publishes every failure into `state$` and never rejects; nothing is left to handle. */
function settledIntoState(): void {
  // Intentionally empty: see the doc comment.
}
