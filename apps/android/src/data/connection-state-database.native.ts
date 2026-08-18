import type { RemoteConnectionState } from "@codewide/sync-client";
import { createCollection, type Collection } from "@tanstack/react-db";
import { persistedCollectionOptions } from "@tanstack/react-native-db-sqlite-persistence";

import { getUiCachePersistence } from "./ui-cache-persistence.native";

export type ConnectionStateRow = {
  id: string;
  connectionId: string;
  state: RemoteConnectionState;
  lastError: string | null;
  lastErrorAt: number | null;
};

export type ConnectionStateDatabase = {
  collection: Collection<ConnectionStateRow, string>;
  reconcileProfiles(profiles: Array<ConnectionStateRow>): void;
  setState(connectionId: string, state: RemoteConnectionState, diagnostic?: string | null): void;
  remove(connectionId: string): void;
  close(): void;
};

type SyncControls = {
  begin(options?: { immediate?: boolean }): void;
  write(change:
    | { type: "insert" | "update"; value: ConnectionStateRow }
    | { type: "delete"; key: string }
  ): void;
  commit(): void;
};

export function createConnectionStateDatabase(): ConnectionStateDatabase {
  let controls: SyncControls | null = null;
  let source = new Map<string, ConnectionStateRow>();
  let bootstrapped = false;
  let disposed = false;
  const collection = createCollection(
    persistedCollectionOptions<ConnectionStateRow, string>({
      id: "connection-states-v1",
      schemaVersion: 1,
      getKey: (row) => row.id,
      persistence: getUiCachePersistence(),
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          controls = { begin, write, commit };
          markReady();
          return { cleanup: () => { controls = null; } };
        },
      },
    }),
  );

  const bootstrap = (): void => {
    if (bootstrapped) return;
    source = new Map(collection.toArray.map((row) => [row.id, row]));
    bootstrapped = true;
  };

  const publish = (row: ConnectionStateRow): void => {
    if (disposed || controls === null) return;
    bootstrap();
    const previous = source.get(row.id);
    if (previous !== undefined && sameState(previous, row)) return;
    source.set(row.id, row);
    controls.begin({ immediate: true });
    controls.write({ type: previous === undefined ? "insert" : "update", value: row });
    controls.commit();
  };

  const remove = (connectionId: string): void => {
    if (disposed || controls === null) return;
    bootstrap();
    if (!source.delete(connectionId)) return;
    controls.begin({ immediate: true });
    controls.write({ type: "delete", key: connectionId });
    controls.commit();
  };

  return {
    collection,
    reconcileProfiles(profiles) {
      if (disposed || controls === null) return;
      bootstrap();
      const profileIds = new Set(profiles.map((profile) => profile.connectionId));
      controls.begin({ immediate: true });
      for (const [id] of source) {
        if (profileIds.has(id)) continue;
        source.delete(id);
        controls.write({ type: "delete", key: id });
      }
      for (const profile of profiles) {
        if (source.has(profile.connectionId)) continue;
        source.set(profile.connectionId, profile);
        controls.write({ type: "insert", value: profile });
      }
      controls.commit();
    },
    setState(connectionId, state, diagnostic) {
      bootstrap();
      const current = source.get(connectionId) ?? {
        id: connectionId,
        connectionId,
        state: "offline" as const,
        lastError: null,
        lastErrorAt: null,
      };
      const clearError = state === "live" || diagnostic === null;
      publish({
        ...current,
        state,
        lastError: clearError ? null : diagnostic === undefined ? current.lastError : diagnostic.slice(0, 1_000),
        lastErrorAt: clearError ? null : diagnostic === undefined ? current.lastErrorAt : Date.now(),
      });
    },
    remove,
    close() {
      disposed = true;
      collection.cleanup();
    },
  };
}

function sameState(left: ConnectionStateRow, right: ConnectionStateRow): boolean {
  return left.state === right.state
    && left.lastError === right.lastError
    && left.lastErrorAt === right.lastErrorAt;
}
