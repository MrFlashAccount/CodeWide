import type { WorkspaceRuntimeSnapshot } from "../data/workspace-runtime";

/** A hydrated profile collection, rather than an empty catalog query, owns this state. */
export function isNoServerWorkspace(runtime: WorkspaceRuntimeSnapshot): boolean {
  return (
    runtime.ready &&
    runtime.connectionProfiles !== null &&
    runtime.connectionProfiles.collection.toArray.length === 0
  );
}
