import { useEffect, type RefObject } from "react";

/** Lifecycle boundary for render-owned capabilities that must close on unmount. */
export function useDisposableLifecycle(handle: RefObject<{ close(): Promise<void> } | null>): void {
  useEffect(
    () => () => {
      handle.current?.close().catch(() => undefined);
    },
    [handle],
  );
}
