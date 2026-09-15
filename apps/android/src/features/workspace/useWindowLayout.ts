import { useSyncExternalStore } from "react";
import { windowLayoutStore } from "../../native/window-layout-store";

/** Subscribes to the shared window-width layout projection. */
export function useWindowLayout() {
  return useSyncExternalStore(
    windowLayoutStore.subscribe,
    windowLayoutStore.getSnapshot,
    windowLayoutStore.getSnapshot,
  );
}
