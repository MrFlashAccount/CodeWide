import type { SavedServerId } from "./ids";

export type ServerSelection =
  | { kind: "all" }
  | { kind: "savedServer"; savedServerId: SavedServerId };
