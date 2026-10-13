import type { CompanionConnectionTransport } from "../native/companionTransportContract";
import { companionHttpUrl } from "./companion-http-url";
import type { StoredConnection } from "./connection-profile-types";
import type { TelemetryBatch } from "./telemetry";

/** Existing session and live-authority access; batching remains telemetry-owned. */
export type WorkspaceTelemetryAuthority = {
  connectionTransport: (connection: StoredConnection) => CompanionConnectionTransport;
  currentConnections: () => StoredConnection[];
  isRpcAvailable: (connectionId: string) => boolean;
  scopedHttpAuthorization: (connection: StoredConnection, forceRefresh: boolean) => Promise<string>;
};

/** Upload through current authenticated authority and retry one rejected session. */
export function createWorkspaceTelemetryUpload({
  connectionTransport,
  currentConnections,
  isRpcAvailable,
  scopedHttpAuthorization,
}: WorkspaceTelemetryAuthority) {
  async function uploadTelemetryBatch(connectionId: string, batch: TelemetryBatch): Promise<void> {
    const connection = currentConnections().find((candidate) => candidate.id === connectionId);
    if (connection === undefined || !connection.enabled) {
      throw new Error("Telemetry connection is unavailable");
    }
    if (!isRpcAvailable(connectionId)) {
      throw new Error("Telemetry waits for an authenticated connection");
    }
    const { baseUrl, transport } = connectionTransport(connection);
    const send = async (forceRefresh: boolean) =>
      transport.fetch(companionHttpUrl(baseUrl, "/v1/telemetry/events"), {
        body: JSON.stringify(batch),
        headers: {
          authorization: await scopedHttpAuthorization(connection, forceRefresh),
          "content-type": "application/json",
        },
        method: "POST",
      });
    let response = await send(false);
    if (response.status === 401) {
      response = await send(true);
    }
    if (!response.ok) {
      throw new Error(`Telemetry upload failed (${String(response.status)})`);
    }
  }

  return uploadTelemetryBatch;
}
