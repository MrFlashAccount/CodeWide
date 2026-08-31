import type { V2PortsResponse, V2TunnelCreateResponse } from "@codewide/sync-client/v2";

import type { SavedServerId } from "../../domain/ids";

export interface PortTransport {
  createTunnel(savedServerId: SavedServerId, port: number): Promise<V2TunnelCreateResponse>;
  deleteTunnel(savedServerId: SavedServerId, tunnelId: string): Promise<void>;
  list(savedServerId: SavedServerId): Promise<V2PortsResponse>;
}
