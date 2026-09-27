import { observable, type Observable } from "@legendapp/state";
import type { RemoteConnectionState } from "@codewide/sync-client";
import type { ConnectionPath } from "./connectionPath";
import { connectionHealth, type ConnectionHealthStatus } from "./connectionHealth";

const MAX_CONNECTION_DIAGNOSTIC_CHARS = 8000;

export type ConnectionStateRow = {
  connectionId: string;
  enabled: boolean;
  id: string;
  lastError: string | null;
  lastErrorAt: number | null;
  rpcAvailable: boolean;
  state: RemoteConnectionState;
};

export type ConnectionStateProfile = Pick<ConnectionStateRow, "id" | "connectionId" | "enabled">;

export type ConnectionStateModel = {
  close: () => void;
  health$: Observable<Record<string, ConnectionHealthStatus>>;
  reconcileProfiles: (profiles: ConnectionStateProfile[]) => void;
  remove: (connectionId: string) => void;
  rows$: Observable<ConnectionStateRow[]>;
  setPath: (connectionId: string, path: ConnectionPath | null) => void;
  // WHY: This extracted V1 signature is shared by existing callers; changing its call shape would expand this behavior-preserving cleanup into an API migration.
  // oxlint-disable-next-line eslint/max-params
  setState: (
    connectionId: string,
    state: RemoteConnectionState,
    diagnostic?: string | null,
    rpcAvailable?: boolean,
  ) => void;
  subscribeChanges: (
    listener: (row: ConnectionStateRow) => void,
    options?: { includeInitialState?: boolean },
  ) => { unsubscribe: () => void };
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
  const health$ = observable<Record<string, ConnectionHealthStatus>>({});
  const paths = new Map<string, ConnectionPath | null>();
  const listeners = new Set<(row: ConnectionStateRow) => void>();
  let disposed = false;

  const updateHealth = (row: ConnectionStateRow): void => {
    health$.assign({
      [row.connectionId]: connectionHealth({ ...row, path: paths.get(row.connectionId) ?? null }),
    });
  };
  const removeHealth = (connectionId: string): void => {
    paths.delete(connectionId);
    health$[connectionId]?.delete();
  };

  const publish = (row: ConnectionStateRow): void => {
    if (disposed) {
      return;
    }
    const rows = rows$.peek();
    const index = rows.findIndex((candidate) => candidate.id === row.id);
    const previous = rows[index];
    if (previous !== undefined && sameState(previous, row)) {
      return;
    }
    rows$.set(
      index === -1
        ? [...rows, row]
        : rows.map((candidate, rowIndex) => (rowIndex === index ? row : candidate)),
    );
    updateHealth(row);
    for (const listener of listeners) {
      listener(row);
    }
  };

  return {
    close() {
      disposed = true;
      paths.clear();
      health$.set({});
      listeners.clear();
      rows$.set([]);
    },
    health$,
    reconcileProfiles(profiles) {
      if (disposed) {
        return;
      }
      const currentRows = rows$.peek();
      const profilesById = new Map(
        profiles.map((profile) => [profile.connectionId, profile] as const),
      );
      const currentIds = new Set(currentRows.map((row) => row.connectionId));
      const nextRows: ConnectionStateRow[] = [];
      const changedRows: ConnectionStateRow[] = [];
      for (const current of currentRows) {
        const profile = profilesById.get(current.connectionId);
        if (profile === undefined) {
          removeHealth(current.connectionId);
          continue;
        }
        if (current.enabled === profile.enabled) {
          nextRows.push(current);
          continue;
        }
        const row: ConnectionStateRow = {
          ...current,
          enabled: profile.enabled,
          lastError: null,
          lastErrorAt: null,
          rpcAvailable: false,
          state: profile.enabled ? "connecting" : "offline",
        };
        nextRows.push(row);
        changedRows.push(row);
      }
      for (const profile of profiles) {
        if (currentIds.has(profile.connectionId)) {
          continue;
        }
        const row: ConnectionStateRow = {
          ...profile,
          lastError: null,
          lastErrorAt: null,
          rpcAvailable: false,
          state: profile.enabled ? "connecting" : "offline",
        };
        nextRows.push(row);
        changedRows.push(row);
      }
      const changed =
        currentRows.length !== nextRows.length ||
        nextRows.some((row, index) => row !== currentRows[index]);
      if (changed) {
        rows$.set(nextRows);
        for (const row of changedRows) {
          updateHealth(row);
          for (const listener of listeners) {
            listener(row);
          }
        }
      }
    },
    remove(connectionId) {
      if (disposed) {
        return;
      }
      const rows = rows$.peek();
      removeHealth(connectionId);
      const nextRows = rows.filter((row) => row.connectionId !== connectionId);
      if (nextRows.length !== rows.length) {
        rows$.set(nextRows);
      }
    },
    rows$,
    setPath(connectionId, path) {
      if (disposed) {
        return;
      }
      const current = rows$.peek().find((row) => row.connectionId === connectionId);
      if (current !== undefined) {
        // OS/path evidence belongs to presentation. Publishing it as a runtime
        // state change invalidates history reads and schedules phantom reconnect
        // repairs, even when the native socket and RPC admission never changed.
        paths.set(connectionId, path);
        updateHealth(current);
      }
    },
    // WHY: This extracted V1 signature is shared by existing callers; changing its call shape would expand this behavior-preserving cleanup into an API migration.
    // oxlint-disable-next-line eslint/max-params
    setState(connectionId, state, diagnostic, rpcAvailable) {
      const current = rows$.peek().find((row) => row.connectionId === connectionId) ?? {
        connectionId,
        enabled: true,
        id: connectionId,
        lastError: null,
        lastErrorAt: null,
        rpcAvailable: false,
        state: "connecting" as const,
      };
      const clearError = state === "live" || diagnostic === null;
      publish({
        ...current,
        lastError: clearError
          ? null
          : diagnostic === undefined
            ? current.lastError
            : diagnostic.slice(0, MAX_CONNECTION_DIAGNOSTIC_CHARS),
        lastErrorAt: clearError
          ? null
          : diagnostic === undefined
            ? current.lastErrorAt
            : Date.now(),
        rpcAvailable: rpcAvailable ?? current.rpcAvailable,
        state,
      });
    },
    subscribeChanges(listener, options) {
      if (disposed) {
        return { unsubscribe: () => undefined };
      }
      listeners.add(listener);
      if (options?.includeInitialState === true) {
        for (const row of rows$.peek()) {
          listener(row);
        }
      }
      return {
        unsubscribe: () => {
          listeners.delete(listener);
        },
      };
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
  return (
    left.enabled === right.enabled &&
    left.state === right.state &&
    left.rpcAvailable === right.rpcAvailable &&
    left.lastError === right.lastError &&
    left.lastErrorAt === right.lastErrorAt
  );
}
