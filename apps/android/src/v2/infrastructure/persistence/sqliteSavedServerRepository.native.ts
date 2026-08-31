import { NativeModules } from "react-native";

import type {
  SavedServerConnection,
  SavedServerRepository,
} from "../../application/ports/savedServerRepository";
import type { SavedServer } from "../../domain/savedServer";
import { savedServerId } from "../../domain/ids";

interface NativeConnectionConfig {
  connectionId: string;
  enabled: boolean;
  endpoint: string;
  savedServerId?: string;
}

interface NativeSavedServerBridge {
  claimPairing(
    savedServerId: string,
    endpoint: string,
    pairingToken: string,
    deviceName: string,
    tlsPinSha256: string,
  ): Promise<{ capabilityToken: string; deviceId: string }>;
  listConnectionConfigs(): Promise<NativeConnectionConfig[]>;
  listSavedServerSummaries(): Promise<unknown>;
  deleteConnectionCredentials(connectionId: string): Promise<void>;
  resetSocket(connectionId: string, reason: string): void;
  saveConnectionCredentials(
    connectionId: string,
    endpoint: string,
    token: string,
    tlsPinSha256: string,
    enabled: boolean,
  ): Promise<void>;
  saveConnectionCredentialsV2?(
    connectionId: string,
    endpoint: string,
    token: string,
    tlsPinSha256: string,
    enabled: boolean,
    deviceId: string,
  ): Promise<void>;
  setConnectionEnabled(connectionId: string, enabled: boolean): Promise<void>;
  wakeSocket(connectionId: string): void;
}

/** Adapter over the sole generation-neutral native saved-server catalog. */
export function createSavedServerRepository(): SavedServerRepository {
  const bridge = NativeModules.CodeWideNative as NativeSavedServerBridge | undefined;
  const requireBridge = (): NativeSavedServerBridge => {
    if (bridge === undefined) throw new Error("Saved server catalog is unavailable");
    return bridge;
  };
  return {
    close: () => undefined,
    async connection(id) {
      const value = (await requireBridge().listConnectionConfigs()).find(
        (row) => (row.savedServerId ?? row.connectionId) === id,
      );
      if (value === undefined) throw new Error("Saved server is unavailable");
      return parseConnection(value, id);
    },
    async delete(id) {
      await requireBridge().deleteConnectionCredentials(id);
    },
    async list() {
      const value = await requireBridge().listSavedServerSummaries();
      if (!Array.isArray(value)) throw new Error("Saved server catalog is invalid");
      return value.map((row, index) => parseSummary(row, index));
    },
    async pair(id, input) {
      await requireBridge().listSavedServerSummaries();
      const claimed = await requireBridge().claimPairing(
        id,
        input.endpoint,
        input.pairingToken,
        "CodeWide Android",
        input.tlsPinSha256,
      );
      const native = requireBridge();
      if (native.saveConnectionCredentialsV2 === undefined) {
        await native.saveConnectionCredentials(
          id,
          input.endpoint,
          claimed.capabilityToken,
          input.tlsPinSha256,
          true,
        );
      } else {
        await native.saveConnectionCredentialsV2(
          id,
          input.endpoint,
          claimed.capabilityToken,
          input.tlsPinSha256,
          true,
          claimed.deviceId,
        );
      }
      native.wakeSocket(id);
    },
    reconnect(id) {
      requireBridge().resetSocket(id, "user_reconnect_v2");
    },
    async setEnabled(id, enabled) {
      const native = requireBridge();
      await native.setConnectionEnabled(id, enabled);
      if (enabled) native.wakeSocket(id);
    },
    subscribe: () => () => undefined,
  };
}

function parseConnection(
  value: NativeConnectionConfig,
  id: SavedServer["id"],
): SavedServerConnection {
  if (
    value === null ||
    typeof value !== "object" ||
    typeof value.connectionId !== "string" ||
    (value.savedServerId ?? value.connectionId) !== id ||
    typeof value.endpoint !== "string" ||
    typeof value.enabled !== "boolean"
  )
    throw new Error("Saved server connection is invalid");
  return { enabled: value.enabled, endpoint: value.endpoint, id };
}

function parseSummary(value: unknown, index: number): SavedServer {
  if (value === null || typeof value !== "object") {
    throw new Error("Saved server summary is invalid");
  }
  const id = Reflect.get(value, "savedServerId");
  const enabled = Reflect.get(value, "enabled");
  if (typeof id !== "string" || typeof enabled !== "boolean") {
    throw new Error("Saved server summary is invalid");
  }
  return { displayName: `Saved server ${index + 1}`, emoji: "🖥️", enabled, id: savedServerId(id) };
}
