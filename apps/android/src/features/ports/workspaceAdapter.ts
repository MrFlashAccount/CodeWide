import { companionHttpUrl } from "../../data/companion-http-url";
import type { StoredConnection } from "../../data/connection-profile-types";
import type {
  TunnelValue,
  WorkspaceResourceDatabase,
} from "../../data/workspace-resource-database";
import { tunnelResourceKey } from "../../data/workspace-resource-keys";
import type { createWorkspaceSession } from "../../data/workspace-session";
import { nativeCompanionHttpOrigin } from "../../native/native-transport";

import type { PortsWorkspaceCapabilities } from "./workspaceCapabilities";
/** Converts ports intents using retained lower authorities. */
export function createPortsWorkspaceAdapter({
  currentConnections,
  getResources,
  scopedHttpAuthorization,
}: {
  currentConnections: () => StoredConnection[];
  getResources: () => WorkspaceResourceDatabase;
  scopedHttpAuthorization: ReturnType<typeof createWorkspaceSession>["scopedHttpAuthorization"];
}): PortsWorkspaceCapabilities {
  const createLocalhostTunnel = async (
    connectionId: string,
    port: number,
    ttlSeconds: number,
  ): Promise<TunnelValue> => {
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
      throw new Error("Port must be between 1 and 65535");
    }
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 3600) {
      throw new Error("TTL must be 30–3600 seconds");
    }
    const key = tunnelResourceKey(connectionId);
    getResources().putTunnel({
      connectionId,
      error: null,
      id: key,
      status: "creating",
      tunnel: null,
    });
    try {
      const connection = currentConnections().find((candidate) => candidate.id === connectionId);
      if (connection === undefined) {
        throw new Error("Connection not found");
      }
      const origin = await nativeCompanionHttpOrigin(connection.id, connection.endpoint);
      const controlUrl = companionHttpUrl(origin, "/v1/tunnels");
      const authorization = await scopedHttpAuthorization(connection);
      const response = await fetch(controlUrl, {
        body: JSON.stringify({ port, ttlSeconds }),
        headers: { authorization, "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(`Tunnel creation failed (${String(response.status)})`);
      }
      const body: unknown = await response.json();
      if (
        body === null ||
        typeof body !== "object" ||
        !("id" in body) ||
        typeof body.id !== "string" ||
        !("expiresAt" in body) ||
        typeof body.expiresAt !== "number" ||
        !Number.isFinite(body.expiresAt) ||
        !("basePath" in body) ||
        typeof body.basePath !== "string"
      ) {
        throw new Error("Tunnel response is invalid");
      }
      const tunnel = {
        authorization,
        expiresAt: body.expiresAt,
        id: body.id,
        url: companionHttpUrl(origin, body.basePath),
      };
      getResources().putTunnel({ connectionId, error: null, id: key, status: "ready", tunnel });
      return tunnel;
    } catch (error) {
      getResources().putTunnel({
        connectionId,
        error: errorMessage(error),
        id: key,
        status: "error",
        tunnel: null,
      });
      throw error;
    }
  };

  const revokeLocalhostTunnel = async (connectionId: string, tunnelId: string): Promise<void> => {
    const connection = currentConnections().find((candidate) => candidate.id === connectionId);
    if (connection === undefined) {
      return;
    }
    const key = tunnelResourceKey(connectionId);
    const current = getResources().tunnels.get(key)?.tunnel ?? null;
    getResources().putTunnel({
      connectionId,
      error: null,
      id: key,
      status: "revoking",
      tunnel: current,
    });
    try {
      const authorization = await scopedHttpAuthorization(connection);
      const origin = await nativeCompanionHttpOrigin(connection.id, connection.endpoint);
      const response = await fetch(
        companionHttpUrl(origin, `/v1/tunnels/${encodeURIComponent(tunnelId)}`),
        {
          headers: { authorization },
          method: "DELETE",
        },
      );
      if (!response.ok && response.status !== 404) {
        throw new Error(`Tunnel revoke failed (${String(response.status)})`);
      }
      getResources().putTunnel({
        connectionId,
        error: null,
        id: key,
        status: "ready",
        tunnel: null,
      });
    } catch (error) {
      getResources().putTunnel({
        connectionId,
        error: errorMessage(error),
        id: key,
        status: "error",
        tunnel: current,
      });
      throw error;
    }
  };
  return { createLocalhostTunnel, revokeLocalhostTunnel };
}
function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Remote operation failed";
}
