import type { RemoteConnectionState } from "@codewide/sync-client";
import * as SecureStore from "expo-secure-store";
import {
  listNativeConnectionConfigs,
  purgeLegacyDerivedStorage,
  saveNativeConnectionCredentials,
} from "../native/native-transport";
import { appLogger } from "../observability/logger";
import type { ConnectionProfileDatabase } from "./connection-profile-database";
import type { StoredConnection } from "./connection-profile-types";
import { connectionDisplayState } from "./connection-state-model";
import { recordTiming } from "./operational-metrics";

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
    } catch (error) {
      // Native credentials below still recover the functional server list.
      // Cosmetic metadata from a corrupt obsolete cache is best-effort only.
      appLogger.warnCaught({
        error: error,
        event: "connection_profile.legacy_metadata_migration.failed",
      });
    }
    await SecureStore.setItemAsync(CONNECTION_PROFILE_STORAGE_MIGRATION_KEY, "1", {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  }
  const nativeCredentialMigrationComplete =
    (await SecureStore.getItemAsync(NATIVE_CREDENTIAL_MIGRATION_KEY)) === "1";
  if (!nativeCredentialMigrationComplete) {
    await Promise.all(
      initialProfiles
        .filter((connection) => connection.token.length > 0)
        .map(async (connection) => {
          await saveNativeConnectionCredentials({
            connectionId: connection.id,
            enabled: connection.enabled,
            endpoint: connection.endpoint,
            token: connection.token,
            ...(connection.tlsPinSha256 === undefined
              ? {}
              : { tlsPinSha256: connection.tlsPinSha256 }),
          });
        }),
    );
    await profiles.migrateLegacyCredentials(async (connection) => {
      await saveNativeConnectionCredentials({
        connectionId: connection.id,
        enabled: connection.enabled,
        endpoint: connection.endpoint,
        token: connection.token,
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
      appLogger.info({
        event: "cache.legacy_data_removed",
        fields: { reclaimedBytes },
      });
    }
  } catch (error) {
    // Cleanup is deliberately non-fatal and retried on the next launch. A
    // locked old WAL must never prevent the server-backed cache from loading.
    appLogger.warnCaught({ error: error, event: "cache.legacy_database_cleanup.failed" });
  }
  return initialProfiles;
}

export function connectionStateSeed(connection: StoredConnection) {
  return {
    connectionId: connection.id,
    enabled: connection.enabled,
    id: connection.id,
  };
}

export function recordConnectionUsability(connection: {
  connectionId: string;
  rpcAvailable: boolean;
  state: RemoteConnectionState;
}): void {
  const effectiveState = connectionDisplayState(connection);
  if (effectiveState === "connecting") {
    if (!connectionAttemptStartedAt.has(connection.connectionId)) {
      connectionAttemptStartedAt.set(connection.connectionId, performance.now());
    }
    return;
  }
  if (effectiveState !== "syncing" && effectiveState !== "live") {
    return;
  }
  const startedAt = connectionAttemptStartedAt.get(connection.connectionId);
  if (startedAt === undefined) {
    return;
  }
  const elapsed = performance.now() - startedAt;
  connectionAttemptStartedAt.delete(connection.connectionId);
  recordTiming("connection_to_usable_ms", elapsed);
  if (__DEV__) {
    appLogger.info({
      event: "connection.usable",
      fields: { connectionId: connection.connectionId, durationMs: Math.round(elapsed) },
    });
  }
}
