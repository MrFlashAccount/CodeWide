import { useSelector } from "@legendapp/state/react";
import { useLiveQuery } from "@tanstack/react-db";
import type { ConnectionProfileDatabase } from "../../data/connection-profile-database";
import {
  connectionDisplayState,
  type ConnectionStateModel,
} from "../../data/connection-state-model";
/** Projects stored profiles with the native foreground-RPC availability claim. */
export function useConnectionProjection(
  profiles: ConnectionProfileDatabase | null,
  connectionState: ConnectionStateModel | null,
) {
  const connectionStateRows = useSelector(() => connectionState?.rows$.get() ?? []);
  const connectionProfileQuery = useLiveQuery(() => profiles?.collection, [profiles]);
  const connectionProfiles =
    profiles?.project(
      connectionProfileQuery.data === undefined ? undefined : [...connectionProfileQuery.data],
    ) ?? [];
  const connections = (() => {
    const states = new Map(connectionStateRows.map((row) => [row.connectionId, row]));
    return connectionProfiles.map((profile) => {
      const state = states.get(profile.id);
      return state === undefined
        ? {
            ...profile,
            state: profile.enabled ? ("connecting" as const) : ("offline" as const),
            lastError: null,
            lastErrorAt: null,
          }
        : {
            ...profile,
            // `live` is a user-visible claim that foreground RPC is available. The
            // native engine publishes both axes; never promote a stale or partial
            // transport state to Live when it cannot serve a request.
            state: connectionDisplayState(state),
            lastError: state.lastError,
            lastErrorAt: state.lastErrorAt,
          };
    });
  })();

  return connections;
}
