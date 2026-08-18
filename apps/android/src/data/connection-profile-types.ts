import type { RemoteConnection, RemoteConnectionState } from "@codewide/sync-client";

export type StoredConnection = RemoteConnection & {
  displayName: string;
  emoji: string;
  sortOrder: number;
  state: RemoteConnectionState;
  lastError: string | null;
  lastErrorAt: number | null;
};

export type ConnectionProfileRow = {
  id: string;
  displayName: string;
  emoji: string;
  endpoint: string;
  tlsPinSha256: string | null;
  enabled: boolean;
  sortOrder: number;
  updatedAt: number;
};
