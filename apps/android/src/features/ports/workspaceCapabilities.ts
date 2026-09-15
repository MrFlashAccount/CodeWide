import type { TunnelValue } from "../../data/workspace-resource-database";
/** Qualified ports operations; transport and persisted state stay with their existing lower owners. */
export type PortsWorkspaceCapabilities = {
  createLocalhostTunnel(
    connectionId: string,
    port: number,
    ttlSeconds: number,
  ): Promise<TunnelValue>;
  revokeLocalhostTunnel(connectionId: string, tunnelId: string): Promise<void>;
};
