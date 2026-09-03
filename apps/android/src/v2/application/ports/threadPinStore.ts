import type { SavedServerId, ThreadId } from "../../domain/ids";

export interface ThreadPinRecord {
  savedServerId: SavedServerId;
  threadId: ThreadId;
}

/** Persists client-local thread organization without changing server projections. */
export interface ThreadPinStore {
  deleteSavedServer(savedServerId: SavedServerId): Promise<void>;
  list(): Promise<ThreadPinRecord[]>;
  setPinned(savedServerId: SavedServerId, threadId: ThreadId, pinned: boolean): Promise<void>;
}
