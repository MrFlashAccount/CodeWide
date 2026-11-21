import { useEffect, useSyncExternalStore } from "react";

import { routeSessionSnapshot, subscribeRouteSessions } from "../services/routeSessionPolicy";
import { searchRouteSessions } from "../services/search/searchRouteSession";
import { workspaceRouteSessionOwner } from "../services/threads/threadRouteParams";
import { useWorkspaceThreadsSearchSessionId } from "./workspaceThreadsRouteState";

/** Retains Search from the mounted Threads route chain across parent-tab blur. */
export function useWorkspaceSearchSessionRetention(): void {
  const sessionId = useWorkspaceThreadsSearchSessionId();
  useSyncExternalStore(subscribeRouteSessions, routeSessionSnapshot, routeSessionSnapshot);
  useEffect(() => {
    if (sessionId === null) {
      return undefined;
    }
    // Explicit close and workspace teardown remain authoritative even while this lease is mounted.
    return searchRouteSessions.retain(sessionId, workspaceRouteSessionOwner);
  }, [sessionId]);
}
