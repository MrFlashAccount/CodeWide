import { useSyncExternalStore } from "react";
import { workspaceRuntime } from "../../data/workspace-runtime";
/** Observes readiness and the existing retained model handles without starting or disposing them. */
export function useWorkspaceRuntime() {
  return useSyncExternalStore(
    workspaceRuntime.subscribe,
    workspaceRuntime.getSnapshot,
    workspaceRuntime.getSnapshot,
  );
}
