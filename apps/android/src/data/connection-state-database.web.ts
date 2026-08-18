import type { RemoteConnectionState } from "@codewide/sync-client";

export type ConnectionStateRow = {
  id: string;
  connectionId: string;
  state: RemoteConnectionState;
  lastError: string | null;
  lastErrorAt: number | null;
};

export type ConnectionStateDatabase = {
  collection: never;
  reconcileProfiles(profiles: ConnectionStateRow[]): void;
  setState(connectionId: string, state: RemoteConnectionState, diagnostic?: string | null): void;
  remove(connectionId: string): void;
  close(): void;
};

export function createConnectionStateDatabase(): ConnectionStateDatabase {
  throw new Error("Connection state database is Android only");
}
