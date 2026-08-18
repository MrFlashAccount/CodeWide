import { open } from "@op-engineering/op-sqlite";
import {
  createReactNativeSQLitePersistence,
  type OpSQLiteDatabaseLike,
  type PersistedCollectionPersistence,
} from "@tanstack/react-native-db-sqlite-persistence";

let settingsPersistence: PersistedCollectionPersistence | null = null;

/**
 * Small durable store for server presentation metadata only.
 *
 * Credentials remain in the Android Keystore-backed native store. Everything
 * that can be reconstructed from the server belongs in getUiCachePersistence
 * instead, so Android's Clear cache action can actually reclaim it.
 */
export function getSettingsPersistence(): PersistedCollectionPersistence {
  if (settingsPersistence !== null) return settingsPersistence;
  // Stable on-device identifier from the first public builds. Do not rename:
  // the product brand is not the Android storage contract.
  const database = open({ name: "codex-remote-settings.db", location: "settings" });
  settingsPersistence = createReactNativeSQLitePersistence({
    database: database as unknown as OpSQLiteDatabaseLike,
  });
  return settingsPersistence;
}
