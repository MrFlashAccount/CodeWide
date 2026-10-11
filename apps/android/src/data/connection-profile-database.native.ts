import type { ConnectionProfileDatabase } from "./connection-profile-database-contract";

export type {
  ConnectionProfileDatabase,
  RuntimeConnectionConfig,
} from "./connection-profile-database-contract";
import { randomUUID } from "expo-crypto";
import * as SecureStore from "expo-secure-store";

import {
  validateConnectionInput,
  validateConnectionProfile,
  validateConnectionRuntimeUpdate,
} from "./connection-validation";
import type { ConnectionProfileRow, StoredConnection } from "./connection-profile-types";
import {
  connectionProfileRowFromUnknown,
  decodeConnectionProfileRow,
} from "./connectionProfilePersistence";
import { readLegacyPersistedRows } from "./legacy-persistence-migration.native";
import { createPersistentCollectionModel } from "./persistent-collection.native";
import { getSettingsSqliteDatabase } from "./settings-persistence.native";
import { openLegacyUiCacheSqliteDatabase } from "./ui-cache-persistence.native";

export function createConnectionProfileDatabase(): ConnectionProfileDatabase {
  const model = createPersistentCollectionModel<ConnectionProfileRow, string>({
    columns: [
      { column: "sort_order", property: "sortOrder", type: "INTEGER" },
      { column: "updated_at", property: "updatedAt", type: "REAL" },
      {
        column: "enabled",
        encode: (value) => (value === true ? 1 : 0),
        property: "enabled",
        type: "INTEGER",
      },
    ],
    database: getSettingsSqliteDatabase(),
    deserialize: decodeConnectionProfileRow,
    getKey: (row) => row.id,
    id: "connection-profiles-v1",
    indexes: [["sortOrder"]],
    legacyCollectionId: "connection-profiles-v1",
    schemaVersion: 1,
    tableName: "codewide_connection_profiles",
  });
  const { collection } = model;

  const project = (
    rows: readonly ConnectionProfileRow[] = collection.toArray,
  ): StoredConnection[] =>
    [...rows]
      .sort((left, right) => {
        const sortOrder = left.sortOrder - right.sortOrder;
        return sortOrder !== 0 ? sortOrder : left.id.localeCompare(right.id);
      })
      .map((row) => toStoredConnection(row, ""));
  const hydrate = async (rows?: ConnectionProfileRow[]): Promise<StoredConnection[]> => {
    await model.ready;
    return project(rows ?? collection.toArray);
  };

  return {
    async add(rawInput, requestedId) {
      const input = validateConnectionInput(rawInput);
      const id = requestedId ?? `connection-${randomUUID()}`;
      const sortOrder = Math.max(-1, ...collection.toArray.map((row) => row.sortOrder)) + 1;
      const transaction = collection.insert({
        displayName: input.displayName,
        enabled: true,
        endpoint: input.endpoint,
        iconId: input.iconId,
        id,
        sortOrder,
        tlsPinSha256: input.tlsPinSha256,
        updatedAt: Date.now(),
      });
      await transaction.isPersisted.promise;
      return {
        displayName: input.displayName,
        enabled: true,
        endpoint: input.endpoint,
        iconId: input.iconId,
        id,
        lastError: null,
        lastErrorAt: null,
        sortOrder,
        state: "offline",
        tlsPinSha256: input.tlsPinSha256,
        token: "",
      };
    },
    close() {
      model.close();
    },
    collection,
    async delete(connectionId) {
      if (collection.has(connectionId)) {
        const transaction = collection.delete(connectionId);
        await transaction.isPersisted.promise;
      }
    },
    hydrate,
    async importLegacy(connections) {
      const missing = connections.filter((connection) => !collection.has(connection.id));
      if (missing.length === 0) {
        return;
      }
      const transaction = collection.insert(missing.map(profileFromStoredConnection));
      await transaction.isPersisted.promise;
    },
    async importLegacyUiCache() {
      await model.ready;
      if (collection.toArray.length > 0) {
        return;
      }
      const legacy = openLegacyUiCacheSqliteDatabase();
      try {
        const rows = await readLegacyPersistedRows<Record<string, unknown>>(
          legacy.database,
          "connection-profiles-v1",
        );
        if (rows.length === 0) {
          return;
        }
        const migrated = rows.flatMap((row) => {
          try {
            return [connectionProfileRowFromUnknown(row)];
          } catch {
            return [];
          }
        });
        if (migrated.length === 0) {
          return;
        }
        const transaction = collection.insert(migrated);
        await transaction.isPersisted.promise;
      } finally {
        legacy.close();
      }
    },
    async migrateLegacyCredentials(migrate) {
      // Upgrade-only adapter. Runtime code never reads or writes a capability
      // outside the Android Keystore-owned native store.
      for (const row of collection.toArray) {
        const token = await SecureStore.getItemAsync(tokenKey(row.id));
        if (token === null || token.length < 32) {
          continue;
        }
        await migrate(toStoredConnection(row, token));
        await SecureStore.deleteItemAsync(tokenKey(row.id));
      }
    },
    async move(connectionId, direction) {
      const rows = [...collection.toArray].sort((left, right) => {
        const sortOrder = left.sortOrder - right.sortOrder;
        return sortOrder !== 0 ? sortOrder : left.id.localeCompare(right.id);
      });
      const index = rows.findIndex((row) => row.id === connectionId);
      const current = rows[index];
      const neighbor = rows[index + direction];
      if (current === undefined || neighbor === undefined) {
        return;
      }
      const currentOrder = current.sortOrder;
      const neighborOrder = neighbor.sortOrder;
      const transaction = collection.update([current.id, neighbor.id], (drafts) => {
        for (const draft of drafts) {
          draft.sortOrder = draft.id === current.id ? neighborOrder : currentOrder;
          draft.updatedAt = Date.now();
        }
      });
      await transaction.isPersisted.promise;
    },
    project,
    async purgeLegacyCredentials(connectionIds) {
      await Promise.all(
        connectionIds.map(async (connectionId) => {
          await SecureStore.deleteItemAsync(tokenKey(connectionId));
        }),
      );
    },
    async reconcileRuntimeConfigs(configs) {
      const missing = configs.filter((config) => !collection.has(config.connectionId));
      // UI metadata without a native runtime row is retained so key
      // invalidation becomes authRequired instead of silent profile loss. It
      // is never used as transport configuration.
      if (missing.length > 0) {
        let sortOrder = Math.max(-1, ...collection.toArray.map((row) => row.sortOrder)) + 1;
        const transaction = collection.insert(
          missing.map((config) => {
            const hostname = new URL(config.endpoint).hostname;
            return {
              displayName: hostname === "" ? "Remote Companion" : hostname,
              enabled: config.enabled,
              endpoint: config.endpoint,
              iconId: "desktop",
              id: config.connectionId,
              sortOrder: sortOrder++,
              tlsPinSha256: config.tlsPinSha256,
              updatedAt: Date.now(),
            };
          }),
        );
        await transaction.isPersisted.promise;
      }
      for (const config of configs) {
        const row = collection.get(config.connectionId);
        if (
          row === undefined ||
          (row.endpoint === config.endpoint &&
            row.tlsPinSha256 === config.tlsPinSha256 &&
            row.enabled === config.enabled)
        ) {
          continue;
        }
        const transaction = collection.update(config.connectionId, (draft) => {
          draft.endpoint = config.endpoint;
          draft.tlsPinSha256 = config.tlsPinSha256;
          draft.enabled = config.enabled;
          draft.updatedAt = Date.now();
        });
        await transaction.isPersisted.promise;
      }
    },
    async setEnabled(connectionId, enabled) {
      const transaction = collection.update(connectionId, (draft) => {
        draft.enabled = enabled;
        draft.updatedAt = Date.now();
      });
      await transaction.isPersisted.promise;
    },
    async update(connectionId, rawInput) {
      const input = validateConnectionRuntimeUpdate(rawInput);
      const transaction = collection.update(connectionId, (draft) => {
        draft.displayName = input.displayName;
        draft.iconId = input.iconId;
        draft.endpoint = input.endpoint;
        draft.tlsPinSha256 = input.tlsPinSha256 ?? null;
        draft.updatedAt = Date.now();
      });
      await transaction.isPersisted.promise;
      return input;
    },
    async updateProfile(connectionId, displayName, iconId) {
      const profile = validateConnectionProfile(displayName, iconId);
      const transaction = collection.update(connectionId, (draft) => {
        draft.displayName = profile.displayName;
        draft.iconId = profile.iconId;
        draft.updatedAt = Date.now();
      });
      await transaction.isPersisted.promise;
    },
  };
}

function profileFromStoredConnection(connection: StoredConnection): ConnectionProfileRow {
  return {
    displayName: connection.displayName,
    enabled: connection.enabled,
    endpoint: connection.endpoint,
    iconId: connection.iconId,
    id: connection.id,
    sortOrder: connection.sortOrder,
    tlsPinSha256: connection.tlsPinSha256 ?? null,
    updatedAt: Date.now(),
  };
}

function toStoredConnection(row: ConnectionProfileRow, token: string): StoredConnection {
  return {
    displayName: row.displayName,
    endpoint: row.endpoint,
    iconId: row.iconId,
    id: row.id,
    ...(row.tlsPinSha256 === null ? {} : { tlsPinSha256: row.tlsPinSha256 }),
    enabled: row.enabled,
    lastError: null,
    lastErrorAt: null,
    sortOrder: row.sortOrder,
    state: "offline",
    token,
  };
}

function tokenKey(connectionId: string): string {
  return `connection-token-${connectionId}`;
}
