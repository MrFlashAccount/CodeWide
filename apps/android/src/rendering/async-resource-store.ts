import { observable, type Observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import { useEffect } from "react";

export type AsyncResourceSnapshot<T> = {
  status: "idle" | "loading" | "ready" | "error";
  value: T | null;
  error: string | null;
};

type Loader<T> = (publish: (value: T) => void, signal: AbortSignal) => Promise<T>;

const MAX_RESIDENT_RESOURCES = 256;
const MAX_RESIDENT_RESOURCE_BYTES = 16 * 1024 * 1024;
const DEFAULT_RESOURCE_BYTES = 512;
const EMPTY_SNAPSHOT: AsyncResourceSnapshot<never> = { status: "idle", value: null, error: null };
const resources = new Map<string, AsyncResource<unknown>>();
let residentResourceBytes = 0;

export type AsyncResourceHandle<T> = {
  readonly snapshot$: Observable<AsyncResourceSnapshot<T>>;
  retain(): () => void;
};

class AsyncResource<T> implements AsyncResourceHandle<T> {
  readonly snapshot$: Observable<AsyncResourceSnapshot<T>>;
  private readonly controller = new AbortController();
  private retainCount = 0;
  private weight = 0;
  private loading = false;
  private retryAttempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly key: string,
    readonly cacheKey: string,
    readonly revision: string | number,
    private readonly loader: Loader<T>,
    private readonly estimateWeight: (value: T) => number,
    private readonly cancelWhenUnobserved: boolean,
  ) {
    this.snapshot$ = observable<AsyncResourceSnapshot<T>>({ status: "loading", value: null, error: null });
    this.load();
  }

  retain(): () => void {
    this.retainCount += 1;
    this.touch();
    if (this.snapshot$.peek().status === "error") this.scheduleRetry(true);
    return () => {
      this.retainCount = Math.max(0, this.retainCount - 1);
      if (this.retainCount === 0 && this.retryTimer !== null) {
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
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

  dispose(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.controller.abort();
    residentResourceBytes -= this.weight;
    this.weight = 0;
  }

  private update(snapshot: AsyncResourceSnapshot<T>): void {
    const nextWeight = snapshot.value === null
      ? 0
      : Math.max(0, Math.ceil(this.estimateWeight(snapshot.value)));
    residentResourceBytes += nextWeight - this.weight;
    this.weight = nextWeight;
    this.snapshot$.set(snapshot);
    pruneResources(this.cacheKey);
  }

  private load(): void {
    if (this.loading || this.controller.signal.aborted) return;
    this.loading = true;
    const previous = this.snapshot$.peek();
    if (previous.status === "error") {
      this.update({ status: "loading", value: previous.value, error: null });
    }
    const operation = Promise.resolve().then(() => this.loader((value) => {
      if (!this.controller.signal.aborted) this.update({ status: "loading", value, error: null });
    }, this.controller.signal));
    void operation.then((value) => {
      if (this.controller.signal.aborted) return;
      this.loading = false;
      this.retryAttempt = 0;
      this.update({ status: "ready", value, error: null });
    }).catch((cause: unknown) => {
      if (this.controller.signal.aborted) return;
      this.loading = false;
      const current = this.snapshot$.peek();
      this.update({
        status: "error",
        value: current.value,
        error: cause instanceof Error ? cause.message : "Resource unavailable",
      });
      this.scheduleRetry(false);
    });
  }

  private scheduleRetry(immediate: boolean): void {
    if (this.retryTimer !== null || this.loading || this.controller.signal.aborted || this.retainCount === 0) return;
    const delay = immediate ? 0 : Math.min(250 * (2 ** this.retryAttempt), 5_000);
    if (!immediate) this.retryAttempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.retainCount > 0) this.load();
    }, delay);
  }

  private touch(): void {
    resources.delete(this.cacheKey);
    resources.set(this.cacheKey, this as unknown as AsyncResource<unknown>);
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
): AsyncResourceSnapshot<T> {
  return useAsyncResourceLifetime(key, revision, loader, estimateWeight, true);
}

function useAsyncResourceLifetime<T>(
  key: string | null,
  revision: string | number,
  loader: Loader<T>,
  estimateWeight: (value: T) => number,
  cancelWhenUnobserved: boolean,
): AsyncResourceSnapshot<T> {
  const resource = key === null ? null : getAsyncResource<T>(key, revision, loader, estimateWeight, cancelWhenUnobserved);
  useEffect(() => {
    if (resource === null) return;
    return resource.retain();
  }, [resource]);
  return useSelector(() => resource === null ? getEmptySnapshot<T>() : resource.snapshot$.get());
}

export function getAsyncResource<T>(
  key: string,
  revision: string | number,
  loader: Loader<T>,
  estimateWeight: (value: T) => number,
  cancelWhenUnobserved: boolean,
): AsyncResourceHandle<T> {
  const cacheKey = asyncResourceCacheKey(key, revision);
  const current = resources.get(cacheKey);
  if (current !== undefined) return current as unknown as AsyncResource<T>;
  const resource = new AsyncResource<T>(key, cacheKey, revision, loader, estimateWeight, cancelWhenUnobserved);
  resources.set(cacheKey, resource as unknown as AsyncResource<unknown>);
  pruneResources(cacheKey);
  return resource;
}

function pruneResources(protectedCacheKey: string | null = null): void {
  if (resources.size <= MAX_RESIDENT_RESOURCES && residentResourceBytes <= MAX_RESIDENT_RESOURCE_BYTES) return;
  for (const [key, resource] of resources) {
    if (key === protectedCacheKey || resource.isObserved()) continue;
    resources.delete(key);
    resource.dispose();
    if (resources.size <= MAX_RESIDENT_RESOURCES && residentResourceBytes <= MAX_RESIDENT_RESOURCE_BYTES) return;
  }
}

function defaultResourceWeight(): number {
  return DEFAULT_RESOURCE_BYTES;
}

function getEmptySnapshot<T>(): AsyncResourceSnapshot<T> {
  return EMPTY_SNAPSHOT;
}
