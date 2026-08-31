import type { SavedServer } from "../../domain/savedServer";

export type SavedServerConnection = {
  enabled: boolean;
  endpoint: string;
  id: SavedServer["id"];
};

export type PairSavedServerInput = {
  endpoint: string;
  pairingToken: string;
  tlsPinSha256: string;
};

export interface SavedServerRepository {
  close(): void;
  connection(id: SavedServer["id"]): Promise<SavedServerConnection>;
  /** Removes the native saved-server identity and all native capabilities for this id. */
  delete(id: SavedServer["id"]): Promise<void>;
  list(): Promise<SavedServer[]>;
  pair(id: SavedServer["id"], input: PairSavedServerInput): Promise<void>;
  reconnect(id: SavedServer["id"]): void;
  setEnabled(id: SavedServer["id"], enabled: boolean): Promise<void>;
  subscribe(listener: () => void): () => void;
}
