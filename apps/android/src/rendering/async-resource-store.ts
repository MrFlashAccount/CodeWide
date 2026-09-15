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
const AUTO_RETRY_BASE_MS = 1_000;
const MAX_AUTO_RETRY_ATTEMPTS = 5;
const EMPTY_SNAPSHOT: AsyncResourceSnapshot<never> = { status: "idle", value: null, error: null };
const resources = new Map<string, AsyncResource<unknown>>();
let residentResourceBytes = 0;

export type AsyncResourceHandle<T> = {
  readonly snapshot$: Observable<AsyncResourceSnapshot<T>>;
  retain(): () => void;
  read(): Promise<T>;
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
      status: "loading",
      value: initialValue,
      error: null,
    });
    this.load();
  }

  retain(): () => void {
    this.retainCount += 1;
    this.touch();
    if (this.snapshot$.peek().status === "error") this.scheduleRetry();
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
  read(): Promise<T> {
    if (this.promise === null) throw new Error("Resource request was not initialized");
    return this.promise;
  }

  dispose(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
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
    if (loader === null || this.loading || this.controller.signal.aborted) return;
    this.loading = true;
    const previous = this.snapshot$.peek();
    if (previous.status === "error") {
      this.update({ status: "loading", value: previous.value, error: null });
    }
    const operation = Promise.resolve().then(() =>
      loader((value) => {
        if (!this.controller.signal.aborted) this.update({ status: "loading", value, error: null });
      }, this.controller.signal),
    );
    this.promise = operation;
    void operation
      .then((value) => {
        if (this.controller.signal.aborted) return;
        this.loading = false;
        this.retryAttempt = 0;
        this.retryable = true;
        // A ready revision is immutable. Retain its result, not the loader's
        // captured source (which may contain an entire base64 image or thread).
        this.loader = null;
        this.update({ status: "ready", value, error: null });
      })
      .catch((cause: unknown) => {
        if (this.controller.signal.aborted) return;
        this.loading = false;
        this.retryable = isRetryableResourceFailure(cause);
        const current = this.snapshot$.peek();
        this.update({
          status: "error",
          value: current.value,
          error: cause instanceof Error ? cause.message : "Resource unavailable",
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
    )
      return;
    const delay = AUTO_RETRY_BASE_MS * 2 ** this.retryAttempt;
    this.retryAttempt += 1;
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
    if (resource === null) return;
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
  if (current !== undefined) return current as unknown as AsyncResource<T>;
  let initialValue: T | null = null;
  if (preservePrevious) {
    for (const previous of resources.values()) {
      if (previous.key !== key) continue;
      // WHY: the caller-owned resource key has one value contract across its
      // revisions; the heterogeneous cache necessarily erases that type.
      const snapshot = previous.snapshot$.peek() as AsyncResourceSnapshot<T>;
      if (snapshot.value !== null) initialValue = snapshot.value;
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
  resources.set(cacheKey, resource as unknown as AsyncResource<unknown>);
  pruneResources(cacheKey);
  return resource;
}

function pruneResources(protectedCacheKey: string | null = null): void {
  if (
    resources.size <= MAX_RESIDENT_RESOURCES &&
    residentResourceBytes <= MAX_RESIDENT_RESOURCE_BYTES
  )
    return;
  for (const [key, resource] of resources) {
    if (key === protectedCacheKey || resource.isObserved()) continue;
    resources.delete(key);
    resource.dispose();
    if (
      resources.size <= MAX_RESIDENT_RESOURCES &&
      residentResourceBytes <= MAX_RESIDENT_RESOURCE_BYTES
    )
      return;
  }
}

function defaultResourceWeight(): number {
  return DEFAULT_RESOURCE_BYTES;
}

function isRetryableResourceFailure(cause: unknown): boolean {
  if (!(cause instanceof Error) || cause.name === "AbortError") return false;
  const explicitStatus = Reflect.get(cause, "status");
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
  if (match === null) return null;
  const status = Number(match[1]);
  return status >= 100 && status <= 599 ? status : null;
}

function getEmptySnapshot<T>(): AsyncResourceSnapshot<T> {
  return EMPTY_SNAPSHOT;
}
