import { companionHttpUrl } from "./companion-http-url";
import type { StoredConnection } from "./connection-profile-types";
import type { TelemetryBatch } from "./telemetry";

/** Existing session and live-authority access; batching remains telemetry-owned. */
export type WorkspaceTelemetryAuthority = {
  currentConnections(): StoredConnection[];
  isRpcAvailable(connectionId: string): boolean;
  nativeCompanionHttpOrigin(connectionId: string, endpoint: string): Promise<string>;
  scopedHttpAuthorization(connection: StoredConnection, forceRefresh: boolean): Promise<string>;
};

/** Upload through current authenticated authority and retry one rejected session. */
export function createWorkspaceTelemetryUpload({
  currentConnections,
  isRpcAvailable,
  nativeCompanionHttpOrigin,
  scopedHttpAuthorization,
}: WorkspaceTelemetryAuthority) {
  async function uploadTelemetryBatch(connectionId: string, batch: TelemetryBatch): Promise<void> {
    const connection = currentConnections().find((candidate) => candidate.id === connectionId);
    if (connection === undefined || !connection.enabled)
      throw new Error("Telemetry connection is unavailable");
    if (!isRpcAvailable(connectionId))
      throw new Error("Telemetry waits for an authenticated connection");
    const origin = await nativeCompanionHttpOrigin(connection.id, connection.endpoint);
    const send = async (forceRefresh: boolean) =>
      await fetch(companionHttpUrl(origin, "/v1/telemetry/events"), {
        method: "POST",
        headers: {
          authorization: await scopedHttpAuthorization(connection, forceRefresh),
          "content-type": "application/json",
        },
        body: JSON.stringify(batch),
      });
    let response = await send(false);
    if (response.status === 401) response = await send(true);
    if (!response.ok) throw new Error(`Telemetry upload failed (${response.status})`);
  }

  return uploadTelemetryBatch;
}
