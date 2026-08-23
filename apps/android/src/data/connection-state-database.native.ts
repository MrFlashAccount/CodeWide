import type { RemoteConnectionState } from "@codewide/sync-client";
import type { Collection } from "@tanstack/react-db";

import { createPersistentCollectionModel } from "./persistent-collection.native";
import { getUiCacheSqliteDatabase } from "./ui-cache-persistence.native";

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

export function createConnectionStateDatabase(): ConnectionStateDatabase {
  let source = new Map<string, ConnectionStateRow>();
  let disposed = false;
  const model = createPersistentCollectionModel<ConnectionStateRow, string>({
    id: "connection-states-v1",
    tableName: "codewide_connection_states",
    schemaVersion: 1,
    database: getUiCacheSqliteDatabase(),
    getKey: (row) => row.id,
    columns: [{ property: "connectionId", column: "connection_id", type: "TEXT" }],
    legacyCollectionId: "connection-states-v1",
    onResidentRows: (rows) => { source = new Map(rows.map((row) => [row.id, row])); },
  });
  const { collection, storage } = model;

  const publish = (row: ConnectionStateRow): void => {
    if (disposed) return;
    const previous = source.get(row.id);
    if (previous !== undefined && sameState(previous, row)) return;
    source.set(row.id, row);
    storage.begin();
    storage.write({ type: previous === undefined ? "insert" : "update", value: row });
    void storage.commit().catch((cause: unknown) => console.warn("Could not persist connection state", cause));
  };

  const remove = (connectionId: string): void => {
    if (disposed) return;
    if (!source.delete(connectionId)) return;
    storage.begin();
    storage.write({ type: "delete", key: connectionId });
    void storage.commit().catch((cause: unknown) => console.warn("Could not delete connection state", cause));
  };

  return {
    collection,
    reconcileProfiles(profiles) {
      if (disposed) return;
      const profileIds = new Set(profiles.map((profile) => profile.connectionId));
      storage.begin();
      for (const [id] of source) {
        if (profileIds.has(id)) continue;
        source.delete(id);
        storage.write({ type: "delete", key: id });
      }
      for (const profile of profiles) {
        if (source.has(profile.connectionId)) continue;
        source.set(profile.connectionId, profile);
        storage.write({ type: "insert", value: profile });
      }
      void storage.commit().catch((cause: unknown) => console.warn("Could not reconcile connection states", cause));
    },
    setState(connectionId, state, diagnostic) {
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
      model.close();
    },
  };
}

function sameState(left: ConnectionStateRow, right: ConnectionStateRow): boolean {
  return left.state === right.state
    && left.lastError === right.lastError
    && left.lastErrorAt === right.lastErrorAt;
}
