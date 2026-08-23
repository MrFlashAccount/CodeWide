import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let now = Date.now();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const notify of listeners) notify();
    }, 1_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot(): number {
  return now;
}

function getServerSnapshot(): number {
  return 0;
}

/** A shared one-second clock. Recording rows subscribe without owning timers. */
export function useSecondClock(enabled: boolean): number {
  return useSyncExternalStore(
    enabled ? subscribe : emptySubscribe,
    enabled ? getSnapshot : getServerSnapshot,
    getServerSnapshot,
  );
}

function emptySubscribe(): () => void {
  return () => undefined;
}
