import type { SavedServerId, ThreadId } from "./ids";

export interface QualifiedThread {
  savedServerId: SavedServerId;
  threadId: ThreadId;
}

export function qualifiedThread(savedServerId: SavedServerId, threadId: ThreadId): QualifiedThread {
  return { savedServerId, threadId };
}
