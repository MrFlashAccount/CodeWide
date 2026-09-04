import { observable, type Observable } from "@legendapp/state";
import type { RemoteConnectionState } from "@codewide/sync-client";

const MAX_CONNECTION_DIAGNOSTIC_CHARS = 8_000;

export type ConnectionStateRow = {
  id: string;
  connectionId: string;
  enabled: boolean;
  state: RemoteConnectionState;
  rpcAvailable: boolean;
  lastError: string | null;
  lastErrorAt: number | null;
};

export type ConnectionStateProfile = Pick<ConnectionStateRow, "id" | "connectionId" | "enabled">;

export type ConnectionStateModel = {
  rows$: Observable<ConnectionStateRow[]>;
  reconcileProfiles(profiles: ConnectionStateProfile[]): void;
  setState(
    connectionId: string,
    state: RemoteConnectionState,
    diagnostic?: string | null,
    rpcAvailable?: boolean,
  ): void;
  remove(connectionId: string): void;
  subscribeChanges(
    listener: (row: ConnectionStateRow) => void,
    options?: { includeInitialState?: boolean },
  ): { unsubscribe(): void };
  close(): void;
};

/**
 * Process-local projection of the native connection engine.
 *
 * Connectivity is not durable application data. Persisting `live` lets a new
 * JS runtime render a stale status before Kotlin has attached and reported the
 * current RPC availability. Connection profiles remain durable; this model is
 * rebuilt as `connecting`/`offline` and then driven only by native events.
 */
export function createConnectionStateModel(): ConnectionStateModel {
  const rows$ = observable<ConnectionStateRow[]>([]);
  const source = new Map<string, ConnectionStateRow>();
  const listeners = new Set<(row: ConnectionStateRow) => void>();
  let disposed = false;

  const publishRows = (): void => {
    rows$.set([...source.values()]);
  };

  const publish = (row: ConnectionStateRow): void => {
    if (disposed) return;
    const previous = source.get(row.id);
    if (previous !== undefined && sameState(previous, row)) return;
    source.set(row.id, row);
    publishRows();
    for (const listener of listeners) listener(row);
  };

  return {
    rows$,
    reconcileProfiles(profiles) {
      if (disposed) return;
      const profileIds = new Set(profiles.map((profile) => profile.connectionId));
      let changed = false;
      const changedRows: ConnectionStateRow[] = [];
      for (const id of source.keys()) {
        if (profileIds.has(id)) continue;
        source.delete(id);
        changed = true;
      }
      for (const profile of profiles) {
        const current = source.get(profile.connectionId);
        if (current === undefined) {
          const row: ConnectionStateRow = {
            ...profile,
            state: profile.enabled ? "connecting" : "offline",
            rpcAvailable: false,
            lastError: null,
            lastErrorAt: null,
          };
          source.set(profile.connectionId, row);
          changedRows.push(row);
          changed = true;
          continue;
        }
        if (current.enabled === profile.enabled) continue;
        const row: ConnectionStateRow = {
          ...current,
          enabled: profile.enabled,
          state: profile.enabled ? "connecting" : "offline",
          rpcAvailable: false,
          lastError: null,
          lastErrorAt: null,
        };
        source.set(profile.connectionId, row);
        changedRows.push(row);
        changed = true;
      }
      if (changed) {
        publishRows();
        for (const row of changedRows) {
          for (const listener of listeners) listener(row);
        }
      }
    },
    setState(connectionId, state, diagnostic, rpcAvailable) {
      const current = source.get(connectionId) ?? {
        id: connectionId,
        connectionId,
        enabled: true,
        state: "connecting" as const,
        rpcAvailable: false,
        lastError: null,
        lastErrorAt: null,
      };
      const clearError = state === "live" || diagnostic === null;
      publish({
        ...current,
        state,
        rpcAvailable: rpcAvailable ?? current.rpcAvailable,
        lastError: clearError ? null : diagnostic === undefined ? current.lastError : diagnostic.slice(0, MAX_CONNECTION_DIAGNOSTIC_CHARS),
        lastErrorAt: clearError ? null : diagnostic === undefined ? current.lastErrorAt : Date.now(),
      });
    },
    remove(connectionId) {
      if (disposed || !source.delete(connectionId)) return;
      publishRows();
    },
    subscribeChanges(listener, options) {
      if (disposed) return { unsubscribe: () => undefined };
      listeners.add(listener);
      if (options?.includeInitialState === true) {
        for (const row of source.values()) listener(row);
      }
      return { unsubscribe: () => listeners.delete(listener) };
    },
    close() {
      disposed = true;
      source.clear();
      listeners.clear();
      rows$.set([]);
    },
  };
}

export function connectionDisplayState(
  connection: Pick<ConnectionStateRow, "state" | "rpcAvailable">,
): RemoteConnectionState {
  return (connection.state === "live" || connection.state === "syncing") && !connection.rpcAvailable
    ? "connecting"
    : connection.state;
}

function sameState(left: ConnectionStateRow, right: ConnectionStateRow): boolean {
  return left.enabled === right.enabled
    && left.state === right.state
    && left.rpcAvailable === right.rpcAvailable
    && left.lastError === right.lastError
    && left.lastErrorAt === right.lastErrorAt;
}
