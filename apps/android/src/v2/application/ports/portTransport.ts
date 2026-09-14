import type { V2PortsResponse, V2TunnelCreateResponse } from "@codewide/sync-client/v2";

import type { SavedServerId } from "../../domain/ids";

export type PortForwardingPreference = "automatic" | "included" | "excluded";

export type PortForwardingStatus = "stopped" | "connecting" | "live" | "unavailable" | "error";

/** A current native forward, not durable port inventory. Only its user policy persists. */
export interface PortForwardingProfile {
  enabled: boolean;
  error: string | null;
  forwardingKey: string | null;
  id: string;
  label: string;
  localPort: number | null;
  port: number;
  preference: PortForwardingPreference;
  preferredLocalPort: number | null;
  previewUrl: string | null;
  savedServerId: SavedServerId;
  status: PortForwardingStatus;
  updatedAt: number;
}

export interface PortForwardingDraft {
  forwardingKey: string | null;
  label: string;
  port: number;
  preference: PortForwardingPreference;
  preferredLocalPort: number | null;
  profileId: string;
}

export type PortForwardingEvent =
  | { savedServerId: SavedServerId; type: "inventory" }
  | { savedServerId: SavedServerId; type: "inventoryError" }
  | { profile: PortForwardingProfile; type: "profile" }
  | { profileId: string; type: "removed" };

export interface PortTransport {
  createTunnel(
    savedServerId: SavedServerId,
    port: number,
    ttlSeconds: number | null,
  ): Promise<V2TunnelCreateResponse>;
  createProfileId(): string;
  deleteTunnel(savedServerId: SavedServerId, tunnelId: string): Promise<void>;
  /** Reads the latest server-pushed inventory, already reconciled by the native owner. */
  discover(savedServerId: SavedServerId): Promise<V2PortsResponse>;
  list(savedServerId: SavedServerId): Promise<PortForwardingProfile[]>;
  /** Excludes a currently discovered service; inventory eviction is native-owned. */
  remove(savedServerId: SavedServerId, profileId: string): Promise<void>;
  start(savedServerId: SavedServerId, profileId: string): Promise<PortForwardingProfile>;
  stop(savedServerId: SavedServerId, profileId: string): Promise<PortForwardingProfile>;
  subscribe(listener: (event: PortForwardingEvent) => void): () => void;
  upsert(savedServerId: SavedServerId, draft: PortForwardingDraft): Promise<PortForwardingProfile>;
}
