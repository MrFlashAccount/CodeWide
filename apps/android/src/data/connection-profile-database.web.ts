import type { ConnectionProfileDatabase } from "./connection-profile-database.native";

export type { ConnectionProfileDatabase } from "./connection-profile-database.native";

export function createConnectionProfileDatabase(): ConnectionProfileDatabase {
  return {
    collection: null as never,
    project() { return []; },
    async importLegacyUiCache() {},
    async importLegacy() {},
    async hydrate() { return []; },
    async migrateLegacyCredentials() {},
    async purgeLegacyCredentials() {},
    async reconcileRuntimeConfigs() {},
    async add() { throw new Error("Android only"); },
    async delete() {},
    async setEnabled() {},
    async updateProfile() {},
    async update() { throw new Error("Android only"); },
    async move() {},
    close() {},
  };
}
