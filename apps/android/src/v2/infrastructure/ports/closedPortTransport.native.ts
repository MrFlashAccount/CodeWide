import { toByteArray } from "base64-js";
import {
  validateV2ContractDefinition,
  type V2PortsResponse,
  type V2TunnelCreateResponse,
} from "@codewide/sync-client/v2";

import type { PortTransport } from "../../application/ports/portTransport";
import { acquireSharedConnectionLease } from "../connection/sharedConnectionAdapter.native";

export function createClosedPortTransport(): PortTransport {
  return {
    async createTunnel(savedServerId, port) {
      const value = await requestJson(savedServerId, "tunnels-v2", {
        operation: "tunnel.create",
        port,
        ttlSeconds: null,
      });
      validateV2ContractDefinition("tunnelCreateResponse", value);
      return value as V2TunnelCreateResponse;
    },
    async deleteTunnel(savedServerId, tunnelId) {
      const connection = await acquireSharedConnectionLease(savedServerId);
      try {
        const response = await connection.lease.request("tunnels-v2", {
          operation: "tunnel.delete",
          tunnelId,
        });
        if (response.status !== 204 && response.status !== 404)
          throw new Error("Could not close tunnel");
      } finally {
        await connection.lease.release();
      }
    },
    async list(savedServerId) {
      const value = await requestJson(savedServerId, "ports-v2", { operation: "ports.list" });
      validateV2ContractDefinition("portsResponse", value);
      return value as V2PortsResponse;
    },
  };
}

async function requestJson(
  savedServerId: string,
  purpose: "ports-v2" | "tunnels-v2",
  input:
    | { operation: "ports.list" }
    | { operation: "tunnel.create"; port: number; ttlSeconds: number | null },
): Promise<unknown> {
  const connection = await acquireSharedConnectionLease(savedServerId);
  try {
    const response = await connection.lease.request(purpose, input);
    if (response.status < 200 || response.status >= 300)
      throw new Error(`Server returned ${response.status}`);
    return JSON.parse(new TextDecoder().decode(toByteArray(response.bodyBase64))) as unknown;
  } finally {
    await connection.lease.release();
  }
}
