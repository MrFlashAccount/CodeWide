import type { RemoteConnectionState } from "@codewide/sync-client";
import * as SecureStore from "expo-secure-store";
import {
  listNativeConnectionConfigs,
  purgeLegacyDerivedStorage,
  saveNativeConnectionCredentials,
} from "../native/native-transport";
import type { ConnectionProfileDatabase } from "./connection-profile-database";
import type { StoredConnection } from "./connection-profile-types";
import { connectionDisplayState } from "./connection-state-model";
import { LegacyRemoteStore } from "./legacy-remote-store";
import { recordTiming } from "./operational-metrics";

const CONNECTION_PROFILE_MIGRATION_KEY = "codex-remote-connection-profiles-v1-migrated";
const CONNECTION_PROFILE_STORAGE_MIGRATION_KEY =
  "codex-remote-connection-profiles-cache-split-v1-migrated";
const NATIVE_CREDENTIAL_MIGRATION_KEY = "codex-remote-native-credentials-v1-migrated";
// One timing owner for the existing application module; native stop does not reset it.
const connectionAttemptStartedAt = new Map<string, number>();

/** Restore profile metadata and reconcile the existing native credential authority. */
export async function migrateConnectionProfiles(
  profiles: ConnectionProfileDatabase,
  onNativeCredentialProjection: () => void,
): Promise<StoredConnection[]> {
  let initialProfiles = await profiles.hydrate();
  const profileStorageMigrationComplete =
    (await SecureStore.getItemAsync(CONNECTION_PROFILE_STORAGE_MIGRATION_KEY)) === "1";
  if (!profileStorageMigrationComplete) {
    try {
      await profiles.importLegacyUiCache();
      initialProfiles = await profiles.hydrate();
    } catch (cause) {
      // Native credentials below still recover the functional server list.
      // Cosmetic metadata from a corrupt obsolete cache is best-effort only.
      console.warn("Could not migrate server profile metadata from the old UI cache", cause);
    }
    await SecureStore.setItemAsync(CONNECTION_PROFILE_STORAGE_MIGRATION_KEY, "1", {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  }
  const connectionMigrationComplete =
    (await SecureStore.getItemAsync(CONNECTION_PROFILE_MIGRATION_KEY)) === "1";
  if (!connectionMigrationComplete) {
    if (initialProfiles.length === 0) {
      const legacyStore = await LegacyRemoteStore.open();
      try {
        await profiles.importLegacy(await legacyStore.listConnections());
      } finally {
        await legacyStore.close();
      }
      initialProfiles = await profiles.hydrate();
    }
    await SecureStore.setItemAsync(CONNECTION_PROFILE_MIGRATION_KEY, "1", {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  }
  const nativeCredentialMigrationComplete =
    (await SecureStore.getItemAsync(NATIVE_CREDENTIAL_MIGRATION_KEY)) === "1";
  if (!nativeCredentialMigrationComplete) {
    for (const connection of initialProfiles) {
      if (connection.token.length === 0) continue;
      await saveNativeConnectionCredentials({
        connectionId: connection.id,
        endpoint: connection.endpoint,
        token: connection.token,
        enabled: connection.enabled,
        ...(connection.tlsPinSha256 === undefined ? {} : { tlsPinSha256: connection.tlsPinSha256 }),
      });
    }
    await profiles.migrateLegacyCredentials(async (connection) => {
      await saveNativeConnectionCredentials({
        connectionId: connection.id,
        endpoint: connection.endpoint,
        token: connection.token,
        enabled: connection.enabled,
        ...(connection.tlsPinSha256 === undefined ? {} : { tlsPinSha256: connection.tlsPinSha256 }),
      });
    });
    await SecureStore.setItemAsync(NATIVE_CREDENTIAL_MIGRATION_KEY, "1", {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  }

  onNativeCredentialProjection();
  const nativeConfigs = await listNativeConnectionConfigs();
  await profiles.purgeLegacyCredentials(nativeConfigs.map((config) => config.connectionId));
  await profiles.reconcileRuntimeConfigs(nativeConfigs);
  initialProfiles = await profiles.hydrate();
  try {
    const reclaimedBytes = await purgeLegacyDerivedStorage();
    if (__DEV__ && reclaimedBytes > 0) {
      console.info(`Removed ${reclaimedBytes} bytes of obsolete local cache data`);
    }
  } catch (cause) {
    // Cleanup is deliberately non-fatal and retried on the next launch. A
    // locked old WAL must never prevent the server-backed cache from loading.
    console.warn("Could not remove obsolete local cache databases", cause);
  }
  return initialProfiles;
}

export function connectionStateSeed(connection: StoredConnection) {
  return {
    id: connection.id,
    connectionId: connection.id,
    enabled: connection.enabled,
  };
}

export function recordConnectionUsability(connection: {
  connectionId: string;
  state: RemoteConnectionState;
  rpcAvailable: boolean;
}): void {
  const effectiveState = connectionDisplayState(connection);
  if (effectiveState === "connecting") {
    if (!connectionAttemptStartedAt.has(connection.connectionId)) {
      connectionAttemptStartedAt.set(connection.connectionId, performance.now());
    }
    return;
  }
  if (effectiveState !== "syncing" && effectiveState !== "live") return;
  const startedAt = connectionAttemptStartedAt.get(connection.connectionId);
  if (startedAt === undefined) return;
  const elapsed = performance.now() - startedAt;
  connectionAttemptStartedAt.delete(connection.connectionId);
  recordTiming("connection_to_usable_ms", elapsed);
  if (__DEV__)
    console.log(
      `[CodeWide perf] connection_to_usable_ms=${Math.round(elapsed)} connection=${connection.connectionId}`,
    );
}
