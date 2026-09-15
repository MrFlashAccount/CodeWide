import type { ConnectionProfileRow } from "./connection-profile-types";
import { localOnlyCollectionOptions } from "@tanstack/db";
import { createCollection } from "@tanstack/react-db";
import type { ConnectionProfileDatabase } from "./connection-profile-database-contract";

export type { ConnectionProfileDatabase } from "./connection-profile-database-contract";

export function createConnectionProfileDatabase(): ConnectionProfileDatabase {
  const collection = createCollection(
    localOnlyCollectionOptions<ConnectionProfileRow, string>({
      id: "connection-profiles-web",
      getKey: (row) => row.id,
    }),
  );
  return {
    collection,
    project() {
      return [];
    },
    async importLegacyUiCache() {},
    async importLegacy() {},
    async hydrate() {
      return [];
    },
    async migrateLegacyCredentials() {},
    async purgeLegacyCredentials() {},
    async reconcileRuntimeConfigs() {},
    async add() {
      throw new Error("Android only");
    },
    async delete() {},
    async setEnabled() {},
    async updateProfile() {},
    async update() {
      throw new Error("Android only");
    },
    async move() {},
    close() {
      void collection.cleanup();
    },
  };
}
