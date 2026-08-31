import type { SavedServerId } from "./ids";

export type SavedServer = {
  displayName: string;
  emoji: string;
  enabled: boolean;
  id: SavedServerId;
};
