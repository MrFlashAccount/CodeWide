import { NativeModules } from "react-native";

import type {
  SavedServerConnection,
  SavedServerRepository,
} from "../../application/ports/savedServerRepository";
import type { SavedServer } from "../../domain/savedServer";
import { savedServerId } from "../../domain/ids";
import {
  createConnectionProfileDatabase,
  type ConnectionProfileDatabase,
} from "../../../data/connection-profile-database";

interface NativeConnectionConfig {
  connectionId: string;
  enabled: boolean;
  endpoint: string;
  savedServerId?: string;
  tlsPinSha256?: string;
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
    token: string | null,
    tlsPinSha256: string | null,
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
  let profiles: ConnectionProfileDatabase | null = null;
  const requireBridge = (): NativeSavedServerBridge => {
    if (bridge === undefined) throw new Error("Saved server catalog is unavailable");
    return bridge;
  };
  const requireProfiles = (): ConnectionProfileDatabase => {
    profiles ??= createConnectionProfileDatabase();
    return profiles;
  };
  return {
    close() {
      profiles?.close();
      profiles = null;
    },
    async connection(id) {
      const value = (await requireBridge().listConnectionConfigs()).find(
        (row) => (row.savedServerId ?? row.connectionId) === id,
      );
      if (value === undefined) throw new Error("Saved server is unavailable");
      return parseConnection(value, id);
    },
    async delete(id) {
      await requireBridge().deleteConnectionCredentials(id);
      await requireProfiles().delete(id);
    },
    async list() {
      const [value, configs] = await Promise.all([
        requireBridge().listSavedServerSummaries(),
        requireBridge().listConnectionConfigs(),
      ]);
      if (!Array.isArray(value)) throw new Error("Saved server catalog is invalid");
      const profileDatabase = requireProfiles();
      await profileDatabase.hydrate();
      await profileDatabase.reconcileRuntimeConfigs(configs.map(runtimeConfig));
      const profileRows = await profileDatabase.hydrate();
      const nativeRows = value.map((row, index) => parseSummary(row, configs, index));
      const byId = new Map(nativeRows.map((row) => [row.id, row]));
      const ordered = profileRows.flatMap((profile) => {
        const native = byId.get(savedServerId(profile.id));
        if (native === undefined) return [];
        byId.delete(native.id);
        return [
          {
            ...native,
            displayName: profile.displayName,
            emoji: profile.emoji,
            endpoint: profile.endpoint,
          },
        ];
      });
      return [...ordered, ...byId.values()];
    },
    async move(id, direction) {
      await requireProfiles().move(id, direction);
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
      await requireProfiles().add(
        {
          displayName: input.displayName,
          emoji: input.emoji,
          endpoint: input.endpoint,
          token: input.pairingToken,
          tlsPinSha256: input.tlsPinSha256,
        },
        id,
      );
      native.wakeSocket(id);
    },
    reconnect(id) {
      requireBridge().resetSocket(id, "user_reconnect_v2");
    },
    async setEnabled(id, enabled) {
      const native = requireBridge();
      await native.setConnectionEnabled(id, enabled);
      await requireProfiles().setEnabled(id, enabled);
      if (enabled) native.wakeSocket(id);
    },
    subscribe: () => () => undefined,
    async update(id, input) {
      const native = requireBridge();
      const existing = await this.connection(id);
      await native.saveConnectionCredentials(
        id,
        input.endpoint,
        input.replacementToken,
        input.tlsPinSha256,
        existing.enabled,
      );
      await requireProfiles().update(id, {
        displayName: input.displayName,
        emoji: input.emoji,
        endpoint: input.endpoint,
        ...(input.replacementToken === null ? {} : { token: input.replacementToken }),
        tlsPinSha256: input.tlsPinSha256,
      });
      if (existing.enabled) native.wakeSocket(id);
    },
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
  return {
    enabled: value.enabled,
    endpoint: value.endpoint,
    id,
    tlsPinSha256: value.tlsPinSha256 ?? null,
  };
}

function parseSummary(
  value: unknown,
  configs: NativeConnectionConfig[],
  index: number,
): SavedServer {
  if (value === null || typeof value !== "object") {
    throw new Error("Saved server summary is invalid");
  }
  const id = Reflect.get(value, "savedServerId");
  const enabled = Reflect.get(value, "enabled");
  if (typeof id !== "string" || typeof enabled !== "boolean") {
    throw new Error("Saved server summary is invalid");
  }
  const config = configs.find(
    (candidate) => (candidate.savedServerId ?? candidate.connectionId) === id,
  );
  return {
    displayName: `Saved server ${index + 1}`,
    emoji: "🖥️",
    enabled,
    endpoint: config?.endpoint ?? "",
    id: savedServerId(id),
  };
}

function runtimeConfig(value: NativeConnectionConfig) {
  return {
    connectionId: value.savedServerId ?? value.connectionId,
    enabled: value.enabled,
    endpoint: value.endpoint,
    tlsPinSha256: value.tlsPinSha256 ?? null,
  };
}
