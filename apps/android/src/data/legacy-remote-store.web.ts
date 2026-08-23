import type { StoredConnection } from "./connection-profile-types";

export class LegacyRemoteStore {
  static async open(): Promise<LegacyRemoteStore> {
    throw new Error("Legacy migration is available in the Android build only");
  }

  async listConnections(): Promise<StoredConnection[]> { return []; }
}
