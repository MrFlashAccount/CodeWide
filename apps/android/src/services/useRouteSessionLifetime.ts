import { useEffect, useSyncExternalStore } from "react";

import { useEvent } from "../react/useEvent";
import { routeSessionSnapshot, subscribeRouteSessions } from "./routeSessionPolicy";

/** Retires the exact retained payload when Router removes its owning destination. */
export function useRouteSessionLifetime(
  sessionId: string | null,
  close: (sessionId: string) => void,
  retain: (sessionId: string) => () => void,
): void {
  useSyncExternalStore(subscribeRouteSessions, routeSessionSnapshot, routeSessionSnapshot);
  const closeSession = useEvent(close);
  const retainSession = useEvent(retain);
  useEffect(() => {
    if (sessionId === null) {
      return undefined;
    }
    const release = retainSession(sessionId);
    return () => {
      closeSession(sessionId);
      release();
    };
  }, [closeSession, retainSession, sessionId]);
}
