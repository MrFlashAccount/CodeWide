import { useSyncExternalStore } from "react";

import { activateRuntime, stopRuntime } from "../../../boot/runtimeSlot";
import type { V2Runtime } from "../../application/v2Runtime";

export type V2RuntimeLifecycleSnapshot =
  | { status: "inactive" }
  | { status: "loading" }
  | { message: string; status: "error" }
  | { status: "ready" };

const resources = new WeakMap<V2Runtime, V2RuntimeLifecycleResource>();

export function useV2RuntimeLifecycle(
  runtime: V2Runtime,
  active: boolean,
): V2RuntimeLifecycleSnapshot {
  const resource = lifecycleResource(runtime);
  const snapshot = useSyncExternalStore(
    active ? resource.subscribe : subscribeToNothing,
    resource.snapshot,
    resource.snapshot,
  );
  return active ? snapshot : { status: "inactive" };
}

/** Owns runtime startup, retry, and cleanup behind external-store retention. */
class V2RuntimeLifecycleResource {
  readonly #listeners = new Set<() => void>();
  readonly #runtime: V2Runtime;
  #generation = 0;
  #snapshot: V2RuntimeLifecycleSnapshot = { status: "loading" };
  #subscriberCount = 0;

  constructor(runtime: V2Runtime) {
    this.#runtime = runtime;
  }

  snapshot = (): V2RuntimeLifecycleSnapshot => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    const subscription = (): void => listener();
    this.#listeners.add(subscription);
    this.#subscriberCount += 1;
    if (this.#subscriberCount === 1) this.#start();
    return () => {
      if (!this.#listeners.delete(subscription)) return;
      this.#subscriberCount -= 1;
      if (this.#subscriberCount === 0) this.#stop();
    };
  };

  #start(): void {
    const generation = ++this.#generation;
    this.#publish({ status: "loading" });
    activateRuntime("v2", () => this.#runtime).then(
      () => {
        if (generation === this.#generation) this.#publish({ status: "ready" });
      },
      () => {
        if (generation === this.#generation) {
          this.#publish({ message: "Could not start CodeWide V2", status: "error" });
        }
      },
    );
  }

  #stop(): void {
    this.#generation += 1;
    stopRuntime("v2").catch(() => undefined);
  }

  #publish(snapshot: V2RuntimeLifecycleSnapshot): void {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener();
  }
}

function lifecycleResource(runtime: V2Runtime): V2RuntimeLifecycleResource {
  const existing = resources.get(runtime);
  if (existing !== undefined) return existing;
  const resource = new V2RuntimeLifecycleResource(runtime);
  resources.set(runtime, resource);
  return resource;
}

function subscribeToNothing(): () => void {
  return unsubscribeNothing;
}

function unsubscribeNothing(): void {}
