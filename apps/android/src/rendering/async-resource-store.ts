import { observable, type Observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import { useEffect } from "react";

export type AsyncResourceSnapshot<T> = {
  error: string | null;
  status: "idle" | "loading" | "ready" | "error";
  value: T | null;
};

type Loader<T> = (publish: (value: T) => void, signal: AbortSignal) => Promise<T>;

const MAX_RESIDENT_RESOURCES = 256;
const MAX_RESIDENT_RESOURCE_BYTES = 16 * 1024 * 1024;
const DEFAULT_RESOURCE_BYTES = 512;
const AUTO_RETRY_BASE_MS = 1000;
const MAX_AUTO_RETRY_ATTEMPTS = 5;
const EMPTY_SNAPSHOT: AsyncResourceSnapshot<never> = { error: null, status: "idle", value: null };
const resources = new Map<string, AsyncResource<unknown>>();
let residentResourceBytes = 0;

export type AsyncResourceHandle<T> = {
  read: () => Promise<T>;
  retain: () => () => void;
  readonly snapshot$: Observable<AsyncResourceSnapshot<T>>;
};

class AsyncResource<T> implements AsyncResourceHandle<T> {
  readonly snapshot$: Observable<AsyncResourceSnapshot<T>>;
  readonly key: string;
  readonly cacheKey: string;
  readonly revision: string | number;
  private loader: Loader<T> | null;
  private readonly estimateWeight: (value: T) => number;
  private readonly cancelWhenUnobserved: boolean;
  private readonly controller = new AbortController();
  private retainCount = 0;
  private weight = 0;
  private loading = false;
  private promise: Promise<T> | null = null;
  private retryAttempt = 0;
  private retryable = true;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    key: string,
    cacheKey: string,
    revision: string | number,
    loader: Loader<T>,
    estimateWeight: (value: T) => number,
    cancelWhenUnobserved: boolean,
    initialValue: T | null,
  ) {
    this.key = key;
    this.cacheKey = cacheKey;
    this.revision = revision;
    this.loader = loader;
    this.estimateWeight = estimateWeight;
    this.cancelWhenUnobserved = cancelWhenUnobserved;
    this.weight = initialValue === null ? 0 : estimateWeight(initialValue);
    residentResourceBytes += this.weight;
    this.snapshot$ = observable<AsyncResourceSnapshot<T>>({
      error: null,
      status: "loading",
      value: initialValue,
    });
    this.load();
  }

  retain(): () => void {
    this.retainCount += 1;
    this.touch();
    if (this.snapshot$.peek().status === "error") {
      this.scheduleRetry();
    }
    return () => {
      this.retainCount = Math.max(0, this.retainCount - 1);
      if (this.retainCount === 0 && this.retryTimer !== null) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
      }
      if (this.retainCount === 0 && this.snapshot$.peek().status === "error") {
        resources.delete(this.cacheKey);
        this.dispose();
        return;
      }
      if (this.retainCount === 0 && this.cancelWhenUnobserved) {
        resources.delete(this.cacheKey);
        this.dispose();
        return;
      }
      pruneResources();
    };
  }

  isObserved(): boolean {
    return this.retainCount > 0;
  }

  /** Shares the model-owned request with a dependent progressive resource. */
  // WHY: Callers pass this Promise to React.use; async would wrap the cached Promise on every read.
  // oxlint-disable-next-line typescript/promise-function-async
  read(): Promise<T> {
    if (this.promise === null) {
      throw new Error("Resource request was not initialized");
    }
    return this.promise;
  }

  dispose(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
    }
    this.retryTimer = null;
    this.controller.abort();
    this.loader = null;
    residentResourceBytes -= this.weight;
    this.weight = 0;
  }

  private update(snapshot: AsyncResourceSnapshot<T>): void {
    const nextWeight =
      snapshot.value === null ? 0 : Math.max(0, Math.ceil(this.estimateWeight(snapshot.value)));
    residentResourceBytes += nextWeight - this.weight;
    this.weight = nextWeight;
    this.snapshot$.set(snapshot);
    pruneResources(this.cacheKey);
  }

  private load(): void {
    const loader = this.loader;
    if (loader === null || this.loading || this.controller.signal.aborted) {
      return;
    }
    this.loading = true;
    const previous = this.snapshot$.peek();
    if (previous.status === "error") {
      this.update({ error: null, status: "loading", value: previous.value });
    }
    const operation = Promise.resolve().then(async () =>
      loader((value) => {
        if (!this.controller.signal.aborted) {
          this.update({ error: null, status: "loading", value });
        }
      }, this.controller.signal),
    );
    this.promise = operation;
    void operation
      .then((value) => {
        if (this.controller.signal.aborted) {
          return;
        }
        this.loading = false;
        this.retryAttempt = 0;
        this.retryable = true;
        // A ready revision is immutable. Retain its result, not the loader's
        // captured source (which may contain an entire base64 image or thread).
        this.loader = null;
        this.update({ error: null, status: "ready", value });
      })
      .catch((error: unknown) => {
        if (this.controller.signal.aborted) {
          return;
        }
        this.loading = false;
        this.retryable = isRetryableResourceFailure(error);
        const current = this.snapshot$.peek();
        this.update({
          error: error instanceof Error ? error.message : "Resource unavailable",
          status: "error",
          value: current.value,
        });
        this.scheduleRetry();
      });
  }

  private scheduleRetry(): void {
    if (
      !this.retryable ||
      this.retryAttempt >= MAX_AUTO_RETRY_ATTEMPTS ||
      this.retryTimer !== null ||
      this.loading ||
      this.controller.signal.aborted ||
      this.retainCount === 0
    ) {
      return;
    }
    const delay = AUTO_RETRY_BASE_MS * 2 ** this.retryAttempt;
    this.retryAttempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.retainCount > 0) {
        this.load();
      }
    }, delay);
  }

  private touch(): void {
    resources.delete(this.cacheKey);
    resources.set(this.cacheKey, eraseResourceType(this));
  }
}

export function asyncResourceCacheKey(key: string, revision: string | number): string {
  return `${key}\u0000${String(revision)}`;
}

export function useAsyncResource<T>(
  key: string | null,
  revision: string | number,
  loader: Loader<T>,
  estimateWeight: (value: T) => number = defaultResourceWeight,
): AsyncResourceSnapshot<T> {
  return useAsyncResourceLifetime(key, revision, loader, estimateWeight, false);
}

/** A component-owned request that is aborted and evicted with its last observer. */
export function useEphemeralAsyncResource<T>(
  key: string | null,
  revision: string | number,
  loader: Loader<T>,
  estimateWeight: (value: T) => number = defaultResourceWeight,
  preservePrevious = false,
): AsyncResourceSnapshot<T> {
  return useAsyncResourceLifetime(key, revision, loader, estimateWeight, true, preservePrevious);
}

function useAsyncResourceLifetime<T>(
  key: string | null,
  revision: string | number,
  loader: Loader<T>,
  estimateWeight: (value: T) => number,
  cancelWhenUnobserved: boolean,
  preservePrevious = false,
): AsyncResourceSnapshot<T> {
  const resource =
    key === null
      ? null
      : getAsyncResource<T>(
          key,
          revision,
          loader,
          estimateWeight,
          cancelWhenUnobserved,
          preservePrevious,
        );
  useEffect(() => {
    if (resource === null) {
      return undefined;
    }
    return resource.retain();
  }, [resource]);
  return useSelector(() => (resource === null ? getEmptySnapshot<T>() : resource.snapshot$.get()));
}

export function getAsyncResource<T>(
  key: string,
  revision: string | number,
  loader: Loader<T>,
  estimateWeight: (value: T) => number,
  cancelWhenUnobserved: boolean,
  preservePrevious = false,
): AsyncResourceHandle<T> {
  const cacheKey = asyncResourceCacheKey(key, revision);
  const current = resources.get(cacheKey);
  if (current !== undefined) {
    return restoreResourceType<T>(current);
  }
  let initialValue: T | null = null;
  if (preservePrevious) {
    for (const previous of resources.values()) {
      if (previous.key !== key) {
        continue;
      }
      // WHY: the caller-owned resource key has one value contract across its
      // revisions; the heterogeneous cache necessarily erases that type.
      const snapshot = restoreResourceType<T>(previous).snapshot$.peek();
      if (snapshot.value !== null) {
        initialValue = snapshot.value;
      }
    }
  }
  const resource = new AsyncResource<T>(
    key,
    cacheKey,
    revision,
    loader,
    estimateWeight,
    cancelWhenUnobserved,
    initialValue,
  );
  resources.set(cacheKey, eraseResourceType(resource));
  pruneResources(cacheKey);
  return resource;
}

function eraseResourceType<Value>(resource: AsyncResource<Value>): AsyncResource<unknown> {
  const erased: unknown = resource;
  // WHY: the cache erases value types by key while the resource preserves its own loader and snapshot contract internally.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return erased as AsyncResource<unknown>;
}

function restoreResourceType<Value>(resource: AsyncResource<unknown>): AsyncResource<Value> {
  const erased: unknown = resource;
  // WHY: callers use the same cache key with one value contract across revisions; the heterogeneous map cannot encode that key-to-type relation.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return erased as AsyncResource<Value>;
}

function pruneResources(protectedCacheKey: string | null = null): void {
  if (
    resources.size <= MAX_RESIDENT_RESOURCES &&
    residentResourceBytes <= MAX_RESIDENT_RESOURCE_BYTES
  ) {
    return;
  }
  for (const [key, resource] of resources) {
    if (key === protectedCacheKey || resource.isObserved()) {
      continue;
    }
    resources.delete(key);
    resource.dispose();
    if (
      resources.size <= MAX_RESIDENT_RESOURCES &&
      residentResourceBytes <= MAX_RESIDENT_RESOURCE_BYTES
    ) {
      return;
    }
  }
}

function defaultResourceWeight(): number {
  return DEFAULT_RESOURCE_BYTES;
}

function isRetryableResourceFailure(cause: unknown): boolean {
  if (!(cause instanceof Error) || cause.name === "AbortError") {
    return false;
  }
  const explicitStatus: unknown = Reflect.get(cause, "status");
  const status =
    typeof explicitStatus === "number" && Number.isInteger(explicitStatus)
      ? explicitStatus
      : httpStatusFromMessage(cause.message);
  if (status !== null) {
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }
  return !/content[_ ]not[_ ]found|\bnot found\b/iu.test(cause.message);
}

function httpStatusFromMessage(message: string): number | null {
  const match = /\((\d{3})\)/u.exec(message);
  if (match === null) {
    return null;
  }
  const status = Number(match[1]);
  return status >= 100 && status <= 599 ? status : null;
}

function getEmptySnapshot<T>(): AsyncResourceSnapshot<T> {
  return EMPTY_SNAPSHOT;
}
