import type { V2SavedServerId } from "./canonical";

/** Durable fail-closed marker written before any saved-server namespace purge. */
export interface V2SavedServerDeletionStore {
  begin(savedServerId: V2SavedServerId): Promise<void>;
  pending(savedServerId: V2SavedServerId): Promise<boolean>;
  listPending(): Promise<V2SavedServerId[]>;
  complete(savedServerId: V2SavedServerId): Promise<void>;
}

export class MemoryV2SavedServerDeletionStore implements V2SavedServerDeletionStore {
  readonly #pending = new Set<V2SavedServerId>();

  async begin(savedServerId: V2SavedServerId): Promise<void> {
    this.#pending.add(savedServerId);
  }

  async pending(savedServerId: V2SavedServerId): Promise<boolean> {
    return this.#pending.has(savedServerId);
  }

  async listPending(): Promise<V2SavedServerId[]> {
    return [...this.#pending];
  }

  async complete(savedServerId: V2SavedServerId): Promise<void> {
    this.#pending.delete(savedServerId);
  }
}
