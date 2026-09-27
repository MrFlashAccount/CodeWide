import type { RemoteConnection, RemoteConnectionState } from "@codewide/sync-client";
import type { ServerIconId } from "./serverIcons";
import type { ConnectionHealthStatus } from "./connectionHealth";

export type StoredConnection = RemoteConnection & {
  displayName: string;
  /** Process-local presentation; never persisted with the connection profile. */
  health?: ConnectionHealthStatus | undefined;
  iconId: ServerIconId;
  lastError: string | null;
  lastErrorAt: number | null;
  sortOrder: number;
  state: RemoteConnectionState;
};

export type ConnectionProfileRow = {
  displayName: string;
  enabled: boolean;
  endpoint: string;
  iconId: ServerIconId;
  id: string;
  sortOrder: number;
  tlsPinSha256: string | null;
  updatedAt: number;
};
