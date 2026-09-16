import type { RemoteConnection, RemoteConnectionState } from "@codewide/sync-client";

export type StoredConnection = RemoteConnection & {
  displayName: string;
  emoji: string;
  lastError: string | null;
  lastErrorAt: number | null;
  sortOrder: number;
  state: RemoteConnectionState;
};

export type ConnectionProfileRow = {
  displayName: string;
  emoji: string;
  enabled: boolean;
  endpoint: string;
  id: string;
  sortOrder: number;
  tlsPinSha256: string | null;
  updatedAt: number;
};
