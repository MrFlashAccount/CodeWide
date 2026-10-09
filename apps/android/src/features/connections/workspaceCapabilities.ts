import type { StoredConnection } from "../../data/connection-profile-types";
import type { ConnectionInput, ConnectionUpdateInput } from "../../data/connection-validation";
import type { ServerIconId } from "../../data/serverIcons";
import type { HostUpdateResource } from "./hostUpdateResourceState";
/** Qualified connections operations; transport and persisted state stay with their existing lower owners. */
export type ConnectionsWorkspaceCapabilities = {
  addConnection: (input: ConnectionInput) => Promise<StoredConnection>;
  deleteConnection: (connectionId: string) => Promise<void>;
  hostUpdates: HostUpdateResource;
  moveConnection: (connectionId: string, direction: -1 | 1) => Promise<void>;
  reconnectConnection: (connectionId: string) => Promise<void>;
  relayUpdates: HostUpdateResource;
  setConnectionEnabled: (connectionId: string, enabled: boolean) => Promise<void>;
  updateConnection: (connectionId: string, input: ConnectionUpdateInput) => Promise<void>;
  updateConnectionProfile: (
    connectionId: string,
    displayName: string,
    iconId: ServerIconId,
  ) => Promise<void>;
};
