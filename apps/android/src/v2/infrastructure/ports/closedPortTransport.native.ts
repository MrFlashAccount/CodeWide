import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import { toByteArray } from "base64-js";
import {
  validateV2ContractDefinition,
  type V2PortsResponse,
  type V2TunnelCreateResponse,
} from "@codewide/sync-client/v2";

import type {
  PortForwardingEvent,
  PortForwardingPreference,
  PortForwardingProfile,
  PortForwardingStatus,
  PortTransport,
} from "../../application/ports/portTransport";
import { savedServerId, type SavedServerId } from "../../domain/ids";
import { acquireSharedConnectionLease } from "../connection/sharedConnectionAdapter.native";

interface NativePortBridge {
  addListener(eventName: string): void;
  discoverPorts(connectionId: string): Promise<string>;
  listPortForwards(connectionId: string): Promise<string>;
  removePortForward(profileId: string): Promise<void>;
  removeListeners(count: number): void;
  startPortForward(profileId: string): Promise<string>;
  stopPortForward(profileId: string): Promise<string>;
  upsertPortForward(
    connectionId: string,
    profileId: string,
    label: string,
    remotePort: number,
    preferredLocalPort: number | null,
    serviceKey: string | null,
    preference: PortForwardingPreference,
  ): Promise<string>;
}

interface TunnelCreateOperation {
  operation: "tunnel.create";
  port: number;
  ttlSeconds: number | null;
}

const PROFILE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
const FORWARDING_KEY_PATTERN = /^[a-f0-9]{64}$/u;
const LOOPBACK_PREVIEW_PATTERN = /^http:\/\/127\.0\.0\.1:\d+\/[A-Za-z0-9_-]{43}\/$/u;
export function createClosedPortTransport(): PortTransport {
  // WHY: React Native exposes native modules through an untyped runtime registry.
  const bridge = NativeModules["CodeWideNative"] as NativePortBridge | undefined;
  const emitter = bridge === undefined ? null : new NativeEventEmitter(bridge);
  const requireBridge = (): NativePortBridge => {
    if (bridge === undefined || Platform.OS !== "android") {
      throw new Error("Native port forwarding is unavailable");
    }
    return bridge;
  };
  return {
    async createTunnel(id, port, ttlSeconds) {
      const value = await requestJson(id, "tunnels-v2", {
        operation: "tunnel.create",
        port,
        ttlSeconds,
      });
      validateV2ContractDefinition("tunnelCreateResponse", value);
      // WHY: Runtime schema validation above proves the generated V2 response shape.
      return value as V2TunnelCreateResponse;
    },
    createProfileId: () => `forward-${globalThis.crypto.randomUUID()}`,
    async deleteTunnel(id, tunnelId) {
      const connection = await acquireSharedConnectionLease(id);
      try {
        const response = await connection.lease.request("tunnels-v2", {
          operation: "tunnel.delete",
          tunnelId,
        });
        if (response.status !== 204 && response.status !== 404) {
          throw new Error(`Tunnel delete returned ${response.status}`);
        }
      } finally {
        await connection.lease.release();
      }
    },
    async discover(id) {
      const value: unknown = JSON.parse(await requireBridge().discoverPorts(id));
      validateV2ContractDefinition("portsResponse", value);
      // WHY: Runtime schema validation above proves the generated V2 response shape.
      return value as V2PortsResponse;
    },
    async list(id) {
      const value: unknown = JSON.parse(await requireBridge().listPortForwards(id));
      if (!Array.isArray(value)) throw new Error("Native port-forward catalog is invalid");
      return value.map((row) => parseProfile(row, id));
    },
    async remove(_id, profileId) {
      requireProfileId(profileId);
      await requireBridge().removePortForward(profileId);
    },
    async start(id, profileId) {
      requireProfileId(profileId);
      const value: unknown = JSON.parse(await requireBridge().startPortForward(profileId));
      return parseProfile(value, id);
    },
    async stop(id, profileId) {
      requireProfileId(profileId);
      const value: unknown = JSON.parse(await requireBridge().stopPortForward(profileId));
      return parseProfile(value, id);
    },
    subscribe(listener) {
      if (emitter === null || Platform.OS !== "android") return () => undefined;
      const subscription = emitter.addListener("CodeWidePortForwardEvent", (raw: unknown) => {
        const event = parseEvent(raw);
        if (event !== null) listener(event);
      });
      return () => subscription.remove();
    },
    async upsert(id, draft) {
      const value: unknown = JSON.parse(
        await requireBridge().upsertPortForward(
          id,
          draft.profileId,
          draft.label,
          draft.port,
          draft.preferredLocalPort,
          draft.forwardingKey,
          draft.preference,
        ),
      );
      return parseProfile(value, id);
    },
  };
}

async function requestJson(
  id: SavedServerId,
  purpose: "tunnels-v2",
  input: TunnelCreateOperation,
): Promise<unknown> {
  const connection = await acquireSharedConnectionLease(id);
  try {
    const response = await connection.lease.request(purpose, input);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Tunnel create returned ${response.status}`);
    }
    const value: unknown = JSON.parse(new TextDecoder().decode(toByteArray(response.bodyBase64)));
    return value;
  } finally {
    await connection.lease.release();
  }
}

function parseEvent(raw: unknown): PortForwardingEvent | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (value === null || typeof value !== "object") return null;
  const type = Reflect.get(value, "type");
  if (type === "removed") {
    const profileId = Reflect.get(value, "id");
    return typeof profileId === "string" && PROFILE_ID_PATTERN.test(profileId)
      ? { profileId, type }
      : null;
  }
  if (type !== "profile") return null;
  try {
    return { profile: parseProfile(Reflect.get(value, "profile")), type };
  } catch {
    return null;
  }
}

function parseProfile(
  value: unknown,
  expectedSavedServerId?: SavedServerId,
): PortForwardingProfile {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Native port-forward profile is invalid");
  }
  const id = Reflect.get(value, "id");
  const connectionId = Reflect.get(value, "connectionId");
  const label = Reflect.get(value, "label");
  const remoteHost = Reflect.get(value, "remoteHost");
  const remotePort = Reflect.get(value, "remotePort");
  const preferredLocalPort = Reflect.get(value, "preferredLocalPort");
  const forwardingKey = Reflect.get(value, "serviceKey");
  const preference = Reflect.get(value, "preference");
  const localPort = Reflect.get(value, "localPort");
  const enabled = Reflect.get(value, "enabled");
  const status = Reflect.get(value, "status");
  const previewUrl = Reflect.get(value, "previewUrl");
  const error = Reflect.get(value, "error");
  const updatedAt = Reflect.get(value, "updatedAt");
  if (
    typeof id !== "string" ||
    !PROFILE_ID_PATTERN.test(id) ||
    typeof connectionId !== "string" ||
    connectionId.length < 1 ||
    connectionId.length > 160 ||
    (expectedSavedServerId !== undefined && connectionId !== expectedSavedServerId) ||
    typeof label !== "string" ||
    label.length < 1 ||
    label.length > 80 ||
    remoteHost !== "127.0.0.1" ||
    !validPort(remotePort) ||
    !(preferredLocalPort === null || validPort(preferredLocalPort)) ||
    !(
      forwardingKey === null ||
      (typeof forwardingKey === "string" && FORWARDING_KEY_PATTERN.test(forwardingKey))
    ) ||
    !isPreference(preference) ||
    !(localPort === null || validPort(localPort)) ||
    typeof enabled !== "boolean" ||
    !isStatus(status) ||
    !(
      previewUrl === null ||
      (typeof previewUrl === "string" && LOOPBACK_PREVIEW_PATTERN.test(previewUrl))
    ) ||
    !(error === null || typeof error === "string") ||
    !Number.isSafeInteger(updatedAt) ||
    typeof updatedAt !== "number" ||
    updatedAt < 0
  ) {
    throw new Error("Native port-forward profile is invalid");
  }
  return {
    enabled,
    error,
    forwardingKey,
    id,
    label,
    localPort,
    port: remotePort,
    preference,
    preferredLocalPort,
    previewUrl,
    savedServerId: savedServerId(connectionId),
    status,
    updatedAt,
  };
}

function requireProfileId(profileId: string): void {
  if (!PROFILE_ID_PATTERN.test(profileId)) throw new Error("Port forwarding profile id is invalid");
}

function validPort(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 65_535;
}

function isPreference(value: unknown): value is PortForwardingPreference {
  return value === "automatic" || value === "included" || value === "excluded";
}

function isStatus(value: unknown): value is PortForwardingStatus {
  return (
    value === "stopped" ||
    value === "connecting" ||
    value === "live" ||
    value === "unavailable" ||
    value === "error"
  );
}
