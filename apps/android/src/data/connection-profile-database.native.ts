import { randomUUID } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { createCollection, type Collection } from "@tanstack/react-db";
import { persistedCollectionOptions } from "@tanstack/react-native-db-sqlite-persistence";

import {
  validateConnectionInput,
  validateConnectionProfile,
  validateConnectionRuntimeUpdate,
  type ConnectionInput,
  type ConnectionUpdateInput,
} from "./connection-validation";
import type { ConnectionProfileRow, StoredConnection } from "./connection-profile-types";
import { getSettingsPersistence } from "./settings-persistence.native";
import { openLegacyUiCachePersistence } from "./ui-cache-persistence.native";

export type ConnectionProfileDatabase = {
  collection: Collection<ConnectionProfileRow, string>;
  project(rows?: ConnectionProfileRow[]): StoredConnection[];
  importLegacyUiCache(): Promise<void>;
  importLegacy(connections: StoredConnection[]): Promise<void>;
  hydrate(rows?: ConnectionProfileRow[]): Promise<StoredConnection[]>;
  migrateLegacyCredentials(migrate: (connection: StoredConnection) => Promise<void>): Promise<void>;
  purgeLegacyCredentials(connectionIds: string[]): Promise<void>;
  reconcileRuntimeConfigs(configs: RuntimeConnectionConfig[]): Promise<void>;
  add(input: ConnectionInput, connectionId?: string): Promise<StoredConnection>;
  delete(connectionId: string): Promise<void>;
  setEnabled(connectionId: string, enabled: boolean): Promise<void>;
  updateProfile(connectionId: string, displayName: string, emoji: string): Promise<void>;
  update(connectionId: string, input: ConnectionUpdateInput): Promise<ConnectionUpdateInput>;
  move(connectionId: string, direction: -1 | 1): Promise<void>;
  close(): void;
};

export type RuntimeConnectionConfig = {
  connectionId: string;
  endpoint: string;
  tlsPinSha256: string | null;
  enabled: boolean;
};

export function createConnectionProfileDatabase(): ConnectionProfileDatabase {
  const collection = createCollection(
    persistedCollectionOptions<ConnectionProfileRow, string>({
      id: "connection-profiles-v1",
      schemaVersion: 1,
      getKey: (row) => row.id,
      persistence: getSettingsPersistence(),
    }),
  );

  const project = (rows = collection.toArray): StoredConnection[] => {
    return [...rows]
      .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
      .map((row) => toStoredConnection(row, ""));
  };
  const hydrate = async (rows = collection.toArray): Promise<StoredConnection[]> => project(rows);

  return {
    collection,
    project,
    async importLegacyUiCache() {
      if (collection.toArray.length > 0) return;
      const legacyPersistence = openLegacyUiCachePersistence();
      const legacyCollection = createCollection(
        persistedCollectionOptions<ConnectionProfileRow, string>({
          id: "connection-profiles-v1",
          schemaVersion: 1,
          getKey: (row) => row.id,
          persistence: legacyPersistence.persistence,
        }),
      );
      try {
        await legacyCollection.preload();
        if (legacyCollection.toArray.length === 0) return;
        const transaction = collection.insert(legacyCollection.toArray.map((row) => ({ ...row })));
        await transaction.isPersisted.promise;
      } finally {
        legacyCollection.cleanup();
        legacyPersistence.close();
      }
    },
    async importLegacy(connections) {
      const missing = connections.filter((connection) => !collection.has(connection.id));
      if (missing.length === 0) return;
      const transaction = collection.insert(missing.map(profileFromStoredConnection));
      await transaction.isPersisted.promise;
    },
    hydrate,
    async migrateLegacyCredentials(migrate) {
      // Upgrade-only adapter. Runtime code never reads or writes a capability
      // outside the Android Keystore-owned native store.
      for (const row of [...collection.toArray]) {
        const token = await SecureStore.getItemAsync(tokenKey(row.id));
        if (token === null || token.length < 32) continue;
        await migrate(toStoredConnection(row, token));
        await SecureStore.deleteItemAsync(tokenKey(row.id));
      }
    },
    async purgeLegacyCredentials(connectionIds) {
      await Promise.all(connectionIds.map(async (connectionId) => {
        await SecureStore.deleteItemAsync(tokenKey(connectionId));
      }));
    },
    async reconcileRuntimeConfigs(configs) {
      const missing = configs.filter((config) => !collection.has(config.connectionId));
      // UI metadata without a native runtime row is retained so key
      // invalidation becomes authRequired instead of silent profile loss. It
      // is never used as transport configuration.
      if (missing.length > 0) {
        let sortOrder = Math.max(-1, ...collection.toArray.map((row) => row.sortOrder)) + 1;
        const transaction = collection.insert(missing.map((config) => ({
          id: config.connectionId,
          displayName: new URL(config.endpoint).hostname || "Remote Codex",
          emoji: "🖥️",
          endpoint: config.endpoint,
          tlsPinSha256: config.tlsPinSha256,
          enabled: config.enabled,
          sortOrder: sortOrder++,
          updatedAt: Date.now(),
        })));
        await transaction.isPersisted.promise;
      }
      for (const config of configs) {
        const row = collection.get(config.connectionId);
        if (row === undefined || (
          row.endpoint === config.endpoint
          && row.tlsPinSha256 === config.tlsPinSha256
          && row.enabled === config.enabled
        )) continue;
        const transaction = collection.update(config.connectionId, (draft) => {
          draft.endpoint = config.endpoint;
          draft.tlsPinSha256 = config.tlsPinSha256;
          draft.enabled = config.enabled;
          draft.updatedAt = Date.now();
        });
        await transaction.isPersisted.promise;
      }
    },
    async add(rawInput, requestedId) {
      const input = validateConnectionInput(rawInput);
      const id = requestedId ?? `connection-${randomUUID()}`;
      const sortOrder = Math.max(-1, ...collection.toArray.map((row) => row.sortOrder)) + 1;
      const transaction = collection.insert({
        id,
        displayName: input.displayName,
        emoji: input.emoji,
        endpoint: input.endpoint,
        tlsPinSha256: input.tlsPinSha256 ?? null,
        enabled: true,
        sortOrder,
        updatedAt: Date.now(),
      });
      await transaction.isPersisted.promise;
      return {
        id,
        displayName: input.displayName,
        emoji: input.emoji,
        endpoint: input.endpoint,
        ...(input.tlsPinSha256 === undefined ? {} : { tlsPinSha256: input.tlsPinSha256 }),
        token: "",
        enabled: true,
        sortOrder,
        state: "offline",
        lastError: null,
        lastErrorAt: null,
      };
    },
    async delete(connectionId) {
      if (collection.has(connectionId)) {
        const transaction = collection.delete(connectionId);
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
    async updateProfile(connectionId, displayName, emoji) {
      const profile = validateConnectionProfile(displayName, emoji);
      const transaction = collection.update(connectionId, (draft) => {
        draft.displayName = profile.displayName;
        draft.emoji = profile.emoji;
        draft.updatedAt = Date.now();
      });
      await transaction.isPersisted.promise;
    },
    async update(connectionId, rawInput) {
      const input = validateConnectionRuntimeUpdate(rawInput);
      const transaction = collection.update(connectionId, (draft) => {
        draft.displayName = input.displayName;
        draft.emoji = input.emoji;
        draft.endpoint = input.endpoint;
        draft.tlsPinSha256 = input.tlsPinSha256 ?? null;
        draft.updatedAt = Date.now();
      });
      await transaction.isPersisted.promise;
      return input;
    },
    async move(connectionId, direction) {
      const rows = [...collection.toArray].sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
      const index = rows.findIndex((row) => row.id === connectionId);
      const current = rows[index];
      const neighbor = rows[index + direction];
      if (current === undefined || neighbor === undefined) return;
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
    close() {
      collection.cleanup();
    },
  };
}

function profileFromStoredConnection(connection: StoredConnection): ConnectionProfileRow {
  return {
    id: connection.id,
    displayName: connection.displayName,
    emoji: connection.emoji,
    endpoint: connection.endpoint,
    tlsPinSha256: connection.tlsPinSha256 ?? null,
    enabled: connection.enabled,
    sortOrder: connection.sortOrder,
    updatedAt: Date.now(),
  };
}

function toStoredConnection(row: ConnectionProfileRow, token: string): StoredConnection {
  return {
    id: row.id,
    displayName: row.displayName,
    emoji: row.emoji,
    endpoint: row.endpoint,
    ...(row.tlsPinSha256 === null ? {} : { tlsPinSha256: row.tlsPinSha256 }),
    enabled: row.enabled,
    sortOrder: row.sortOrder,
    token,
    state: "offline",
    lastError: null,
    lastErrorAt: null,
  };
}

function tokenKey(connectionId: string): string {
  return `connection-token-${connectionId}`;
}
