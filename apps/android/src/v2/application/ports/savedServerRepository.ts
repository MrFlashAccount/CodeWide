import type { SavedServer } from "../../domain/savedServer";

export interface SavedServerConnection {
  enabled: boolean;
  endpoint: string;
  id: SavedServer["id"];
  tlsPinSha256: string | null;
}

export interface UpdateSavedServerInput {
  displayName: string;
  emoji: string;
  endpoint: string;
  replacementToken: string | null;
  tlsPinSha256: string;
}

export interface PairSavedServerInput {
  displayName: string;
  emoji: string;
  endpoint: string;
  pairingToken: string;
  tlsPinSha256: string;
}

export interface PairingPreview extends PairSavedServerInput {
  expiresAt: number;
}

export interface SavedServerRepository {
  close(): void;
  connection(id: SavedServer["id"]): Promise<SavedServerConnection>;
  /** Removes the native saved-server identity and all native capabilities for this id. */
  delete(id: SavedServer["id"]): Promise<void>;
  list(): Promise<SavedServer[]>;
  move(id: SavedServer["id"], direction: -1 | 1): Promise<void>;
  pair(id: SavedServer["id"], input: PairSavedServerInput): Promise<void>;
  reconnect(id: SavedServer["id"]): void;
  setEnabled(id: SavedServer["id"], enabled: boolean): Promise<void>;
  subscribe(listener: () => void): () => void;
  update(id: SavedServer["id"], input: UpdateSavedServerInput): Promise<void>;
}
