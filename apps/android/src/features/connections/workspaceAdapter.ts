import { randomUUID } from "expo-crypto";
import { PermissionsAndroid, Platform } from "react-native";
import type { AccountRateLimitsDatabase } from "../../data/account-rate-limits-database";
import { composerUploads } from "../../data/composer-uploads";
import type { ConnectionProfileDatabase } from "../../data/connection-profile-database";
import type { StoredConnection } from "../../data/connection-profile-types";
import type { ConnectionStateModel } from "../../data/connection-state-model";
import {
  validateConnectionInput,
  validateConnectionRuntimeUpdate,
  type ConnectionInput,
  type ConnectionUpdateInput,
} from "../../data/connection-validation";
import type { ThreadUiStateDatabase } from "../../data/thread-ui-state-database";
import type { WorkspaceSyncSession } from "../../data/workspace-session";
import {
  claimNativePairing,
  deleteNativeConnection,
  listNativeConnectionConfigs,
  reconnectNativeConnection,
  saveNativeConnectionCredentials,
  setNativeConnectionEnabled,
  wakeNativeConnection,
} from "../../native/native-transport";

import type { ConnectionsWorkspaceCapabilities } from "./workspaceCapabilities";
/** Converts connections intents using retained lower authorities. */
export function createConnectionsWorkspaceAdapter({
  getProfiles,
  getConnectionState,
  getThreadUiState,
  getAccountRateLimits,
  getSession,
  forgetObservedThread,
  invalidateCatalog,
  closeCatalogWindows,
  currentConnections,
  forgetHttpAuthorization,
}: {
  getProfiles(): ConnectionProfileDatabase | null;
  getConnectionState(): ConnectionStateModel | null;
  getThreadUiState(): ThreadUiStateDatabase | null;
  getAccountRateLimits(): AccountRateLimitsDatabase | null;
  getSession(connectionId: string): WorkspaceSyncSession | undefined;
  forgetObservedThread(connectionId: string): void;
  invalidateCatalog(connectionId: string): void;
  closeCatalogWindows(connectionId: string): void;
  currentConnections: () => StoredConnection[];
  forgetHttpAuthorization: (connectionId: string) => void;
}): ConnectionsWorkspaceCapabilities {
  const refreshConnectionProfiles = async (): Promise<StoredConnection[]> => {
    return await requireConnectionProfileDatabase(getProfiles()).hydrate();
  };
  const addConnection = async (input: ConnectionInput) => {
    // Pairing consumes a one-time host token. Prove that the durable local
    // projection is available before crossing that irreversible boundary.
    const profiles = requireConnectionProfileDatabase(getProfiles());
    if (Platform.OS === "android" && Platform.Version >= 33) {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    }
    const validated = validateConnectionInput(input);
    const connectionId = `saved-server-${randomUUID()}`;
    const claimed = await claimNativePairing({
      savedServerId: connectionId,
      endpoint: validated.endpoint,
      pairingToken: validated.token,
      deviceName: "CodeWide Android",
      tlsPinSha256: validated.tlsPinSha256,
    });
    const nativeCredentials = {
      connectionId,
      endpoint: validated.endpoint,
      token: claimed.capabilityToken,
      enabled: true,
      tlsPinSha256: validated.tlsPinSha256,
      deviceId: claimed.deviceId,
    };
    try {
      await saveNativeConnectionCredentials(nativeCredentials);
      const connection = await profiles.add(
        { ...validated, token: claimed.capabilityToken },
        connectionId,
      );
      wakeNativeConnection(connection.id);
      await refreshConnectionProfiles();
      getConnectionState()?.setState(connection.id, "connecting", null, false);
      return connection;
    } catch (cause) {
      // A successful claim cannot be rolled back. Retain/retry the native
      // capability, then rebuild the disposable UI projection from Kotlin.
      // This also recovers a write that committed before reporting an error.
      try {
        await saveNativeConnectionCredentials(nativeCredentials);
        const nativeConfigs = await listNativeConnectionConfigs();
        await profiles.reconcileRuntimeConfigs(nativeConfigs);
        const reconciledProfiles = await refreshConnectionProfiles();
        const recovered = reconciledProfiles.find((connection) => connection.id === connectionId);
        if (recovered !== undefined) {
          wakeNativeConnection(recovered.id);
          getConnectionState()?.setState(recovered.id, "connecting", null, false);
          return recovered;
        }
      } catch {
        // Preserve the original pairing failure below. Startup reconciliation
        // gets another chance if the native credential write did persist.
      }
      throw cause;
    }
  };

  const deleteConnection = async (connectionId: string) => {
    composerUploads.deleteConnection(connectionId);
    getSession(connectionId)?.stop();
    const finalizeSavedServerDelete = async () => {
      await deleteNativeConnection(connectionId);
      await requireConnectionProfileDatabase(getProfiles()).delete(connectionId);
    };
    await finalizeSavedServerDelete();
    forgetHttpAuthorization(connectionId);
    forgetObservedThread(connectionId);
    invalidateCatalog(connectionId);
    await refreshConnectionProfiles();
    getConnectionState()?.remove(connectionId);
    getAccountRateLimits()?.remove(connectionId);
    await getThreadUiState()?.deleteConnection(connectionId);
  };

  const setConnectionEnabled = async (connectionId: string, enabled: boolean) => {
    const profiles = requireConnectionProfileDatabase(getProfiles());
    await setNativeConnectionEnabled(connectionId, enabled);
    await profiles.setEnabled(connectionId, enabled);
    if (!enabled) getSession(connectionId)?.stop();
    if (!enabled) forgetObservedThread(connectionId);
    if (!enabled) closeCatalogWindows(connectionId);
    await refreshConnectionProfiles();
    getConnectionState()?.setState(connectionId, enabled ? "connecting" : "offline", null, false);
  };

  const reconnectConnection = async (connectionId: string): Promise<void> => {
    const connection = currentConnections().find((candidate) => candidate.id === connectionId);
    if (connection === undefined || !connection.enabled)
      throw new Error("Connection is disabled or missing");
    getConnectionState()?.setState(connectionId, "connecting", null, false);
    reconnectNativeConnection(connectionId);
  };

  const updateConnectionProfile = async (
    connectionId: string,
    displayName: string,
    emoji: string,
  ) => {
    await requireConnectionProfileDatabase(getProfiles()).updateProfile(
      connectionId,
      displayName,
      emoji,
    );
    await refreshConnectionProfiles();
  };

  const updateConnection = async (connectionId: string, input: ConnectionUpdateInput) => {
    const enabled =
      currentConnections().find((connection) => connection.id === connectionId)?.enabled ?? true;
    const profiles = requireConnectionProfileDatabase(getProfiles());
    const updated = validateConnectionRuntimeUpdate(input);
    await saveNativeConnectionCredentials({
      connectionId,
      endpoint: updated.endpoint,
      ...(updated.token === undefined ? {} : { token: updated.token }),
      enabled,
      ...(updated.tlsPinSha256 === undefined ? {} : { tlsPinSha256: updated.tlsPinSha256 }),
    });
    await profiles.update(connectionId, updated);
    if (enabled) wakeNativeConnection(connectionId);
    forgetHttpAuthorization(connectionId);
    await refreshConnectionProfiles();
    getConnectionState()?.setState(connectionId, "connecting", null, false);
  };

  const moveConnection = async (connectionId: string, direction: -1 | 1) => {
    await requireConnectionProfileDatabase(getProfiles()).move(connectionId, direction);
    await refreshConnectionProfiles();
  };
  return {
    addConnection,
    deleteConnection,
    setConnectionEnabled,
    reconnectConnection,
    updateConnectionProfile,
    updateConnection,
    moveConnection,
  };
}
function requireConnectionProfileDatabase(
  database: ConnectionProfileDatabase | null,
): ConnectionProfileDatabase {
  if (database === null) throw new Error("Local connection profiles are not ready");
  return database;
}
