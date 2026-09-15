import { useSyncExternalStore } from "react";
import { windowLayoutStore } from "../../native/window-layout-store";
export function useWindowLayout() {
  return useSyncExternalStore(
    windowLayoutStore.subscribe,
    windowLayoutStore.getSnapshot,
    windowLayoutStore.getSnapshot,
  );
}
