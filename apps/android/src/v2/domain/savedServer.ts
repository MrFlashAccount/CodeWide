import type { SavedServerId } from "./ids";

export interface SavedServer {
  displayName: string;
  emoji: string;
  enabled: boolean;
  id: SavedServerId;
}
