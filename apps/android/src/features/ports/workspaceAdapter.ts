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
  getResources,
  currentConnections,
  scopedHttpAuthorization,
}: {
  getResources(): WorkspaceResourceDatabase;
  currentConnections: () => StoredConnection[];
  scopedHttpAuthorization: ReturnType<typeof createWorkspaceSession>["scopedHttpAuthorization"];
}): PortsWorkspaceCapabilities {
  const createLocalhostTunnel = async (
    connectionId: string,
    port: number,
    ttlSeconds: number,
  ): Promise<TunnelValue> => {
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
      throw new Error("Port must be between 1 and 65535");
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 3_600)
      throw new Error("TTL must be 30–3600 seconds");
    const key = tunnelResourceKey(connectionId);
    getResources().putTunnel({
      id: key,
      connectionId,
      status: "creating",
      tunnel: null,
      error: null,
    });
    try {
      const connection = currentConnections().find((candidate) => candidate.id === connectionId);
      if (connection === undefined) throw new Error("Connection not found");
      const origin = await nativeCompanionHttpOrigin(connection.id, connection.endpoint);
      const controlUrl = companionHttpUrl(origin, "/v1/tunnels");
      const authorization = await scopedHttpAuthorization(connection);
      const response = await fetch(controlUrl, {
        method: "POST",
        headers: { authorization, "content-type": "application/json" },
        body: JSON.stringify({ port, ttlSeconds }),
      });
      if (!response.ok) throw new Error(`Tunnel creation failed (${response.status})`);
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
        id: body.id,
        expiresAt: body.expiresAt,
        url: companionHttpUrl(origin, body.basePath),
        authorization,
      };
      getResources().putTunnel({ id: key, connectionId, status: "ready", tunnel, error: null });
      return tunnel;
    } catch (cause) {
      getResources().putTunnel({
        id: key,
        connectionId,
        status: "error",
        tunnel: null,
        error: errorMessage(cause),
      });
      throw cause;
    }
  };

  const revokeLocalhostTunnel = async (connectionId: string, tunnelId: string): Promise<void> => {
    const connection = currentConnections().find((candidate) => candidate.id === connectionId);
    if (connection === undefined) return;
    const key = tunnelResourceKey(connectionId);
    const current = getResources().tunnels.get(key)?.tunnel ?? null;
    getResources().putTunnel({
      id: key,
      connectionId,
      status: "revoking",
      tunnel: current,
      error: null,
    });
    try {
      const authorization = await scopedHttpAuthorization(connection);
      const origin = await nativeCompanionHttpOrigin(connection.id, connection.endpoint);
      const response = await fetch(
        companionHttpUrl(origin, `/v1/tunnels/${encodeURIComponent(tunnelId)}`),
        {
          method: "DELETE",
          headers: { authorization },
        },
      );
      if (!response.ok && response.status !== 404)
        throw new Error(`Tunnel revoke failed (${response.status})`);
      getResources().putTunnel({
        id: key,
        connectionId,
        status: "ready",
        tunnel: null,
        error: null,
      });
    } catch (cause) {
      getResources().putTunnel({
        id: key,
        connectionId,
        status: "error",
        tunnel: current,
        error: errorMessage(cause),
      });
      throw cause;
    }
  };
  return { createLocalhostTunnel, revokeLocalhostTunnel };
}
function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Remote operation failed";
}
