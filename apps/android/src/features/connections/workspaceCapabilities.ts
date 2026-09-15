import type { StoredConnection } from "../../data/connection-profile-types";
import type { ConnectionInput, ConnectionUpdateInput } from "../../data/connection-validation";
/** Qualified connections operations; transport and persisted state stay with their existing lower owners. */
export type ConnectionsWorkspaceCapabilities = {
  addConnection(input: ConnectionInput): Promise<StoredConnection>;
  deleteConnection(connectionId: string): Promise<void>;
  setConnectionEnabled(connectionId: string, enabled: boolean): Promise<void>;
  reconnectConnection(connectionId: string): Promise<void>;
  updateConnectionProfile(connectionId: string, displayName: string, emoji: string): Promise<void>;
  updateConnection(connectionId: string, input: ConnectionUpdateInput): Promise<void>;
  moveConnection(connectionId: string, direction: -1 | 1): Promise<void>;
};
