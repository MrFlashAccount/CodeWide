import type { ConnectionProfileRow } from "./connection-profile-types";
import { localOnlyCollectionOptions } from "@tanstack/db";
import { createCollection } from "@tanstack/react-db";
import type { ConnectionProfileDatabase } from "./connection-profile-database-contract";

export type { ConnectionProfileDatabase } from "./connection-profile-database-contract";

export function createConnectionProfileDatabase(): ConnectionProfileDatabase {
  const collection = createCollection(
    localOnlyCollectionOptions<ConnectionProfileRow, string>({
      getKey: (row) => row.id,
      id: "connection-profiles-web",
    }),
  );
  return {
    async add() {
      await Promise.resolve();
      throw new Error("Android only");
    },
    close() {
      collection.cleanup().catch(() => undefined);
    },
    collection,
    async delete() {
      await Promise.resolve();
    },
    async hydrate() {
      await Promise.resolve();
      return [];
    },
    async importLegacy() {
      await Promise.resolve();
    },
    async importLegacyUiCache() {
      await Promise.resolve();
    },
    async migrateLegacyCredentials() {
      await Promise.resolve();
    },
    async move() {
      await Promise.resolve();
    },
    project() {
      return [];
    },
    async purgeLegacyCredentials() {
      await Promise.resolve();
    },
    async reconcileRuntimeConfigs() {
      await Promise.resolve();
    },
    async setEnabled() {
      await Promise.resolve();
    },
    async update() {
      await Promise.resolve();
      throw new Error("Android only");
    },
    async updateProfile() {
      await Promise.resolve();
    },
  };
}
