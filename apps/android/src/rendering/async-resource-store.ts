import { useEffect, useEffectEvent, useSyncExternalStore } from "react";

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

class AsyncResource<T> {
  private snapshot: AsyncResourceSnapshot<T> = EMPTY_SNAPSHOT;
  private listeners = new Set<() => void>();
  private revision: string | number | null = null;
  private controller: AbortController | null = null;
  private weight = 0;

  constructor(
    readonly key: string,
    private readonly estimateWeight: (value: T) => number,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    this.touch();
    return () => {
      this.listeners.delete(listener);
      pruneResources();
    };
  };

  getSnapshot = (): AsyncResourceSnapshot<T> => this.snapshot;

  load(revision: string | number, loader: Loader<T>): void {
    this.touch();
    if (this.revision === revision && this.snapshot.status !== "error") return;
    this.revision = revision;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.update({ status: "loading", value: null, error: null });
    void loader((value) => {
      if (!controller.signal.aborted) this.update({ status: "loading", value, error: null });
    }, controller.signal).then((value) => {
      if (!controller.signal.aborted) this.update({ status: "ready", value, error: null });
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) {
        this.update({
          status: "error",
          value: null,
          error: cause instanceof Error ? cause.message : "Resource unavailable",
        });
      }
    });
  }

  isObserved(): boolean {
    return this.listeners.size > 0;
  }

  dispose(): void {
    this.controller?.abort();
    residentResourceBytes -= this.weight;
    this.weight = 0;
  }

  private update(snapshot: AsyncResourceSnapshot<T>): void {
    const nextWeight = snapshot.value === null
      ? 0
      : Math.max(0, Math.ceil(this.estimateWeight(snapshot.value)));
    residentResourceBytes += nextWeight - this.weight;
    this.weight = nextWeight;
    this.snapshot = snapshot;
    this.listeners.forEach((listener) => listener());
    pruneResources();
  }

  private touch(): void {
    resources.delete(this.key);
    resources.set(this.key, this as AsyncResource<unknown>);
  }
}

export function useAsyncResource<T>(
  key: string | null,
  revision: string | number,
  loader: Loader<T>,
  estimateWeight: (value: T) => number = defaultResourceWeight,
): AsyncResourceSnapshot<T> {
  const resource = key === null ? null : getResource<T>(key, estimateWeight);
  const load = useEffectEvent(loader);
  useEffect(() => {
    if (resource === null) return;
    resource.load(revision, (publish, signal) => load(publish, signal));
  }, [resource, revision]);
  const snapshot = useSyncExternalStore(
    resource?.subscribe ?? emptySubscribe,
    resource?.getSnapshot ?? getEmptySnapshot<T>,
    resource?.getSnapshot ?? getEmptySnapshot<T>,
  );
  return snapshot;
}

function getResource<T>(key: string, estimateWeight: (value: T) => number): AsyncResource<T> {
  const current = resources.get(key);
  if (current !== undefined) return current as AsyncResource<T>;
  const resource = new AsyncResource<T>(key, estimateWeight);
  resources.set(key, resource as AsyncResource<unknown>);
  pruneResources();
  return resource;
}

function pruneResources(): void {
  if (resources.size <= MAX_RESIDENT_RESOURCES && residentResourceBytes <= MAX_RESIDENT_RESOURCE_BYTES) return;
  for (const [key, resource] of resources) {
    if (resource.isObserved()) continue;
    resources.delete(key);
    resource.dispose();
    if (resources.size <= MAX_RESIDENT_RESOURCES && residentResourceBytes <= MAX_RESIDENT_RESOURCE_BYTES) return;
  }
}

function defaultResourceWeight(): number {
  return DEFAULT_RESOURCE_BYTES;
}

function emptySubscribe(): () => void {
  return () => undefined;
}

function getEmptySnapshot<T>(): AsyncResourceSnapshot<T> {
  return EMPTY_SNAPSHOT;
}
