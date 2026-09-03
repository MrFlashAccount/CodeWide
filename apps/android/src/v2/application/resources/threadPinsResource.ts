import type { ThreadPinStore } from "../ports/threadPinStore";
import type { SavedServerId, ThreadId } from "../../domain/ids";
import { ObservableResource } from "./resource";

export type ThreadPinsSnapshot = ReadonlyMap<SavedServerId, ReadonlySet<ThreadId>>;

/** Owns the durable, client-local pin projection for every saved server. */
export class ThreadPinsResource extends ObservableResource<ThreadPinsSnapshot> {
  readonly #store: ThreadPinStore;

  constructor(store: ThreadPinStore) {
    super(new Map());
    this.#store = store;
  }

  async start(): Promise<void> {
    try {
      const pins = new Map<SavedServerId, Set<ThreadId>>();
      for (const record of await this.#store.list()) {
        const serverPins = pins.get(record.savedServerId) ?? new Set<ThreadId>();
        serverPins.add(record.threadId);
        pins.set(record.savedServerId, serverPins);
      }
      this.publish({ status: "ready", value: pins });
    } catch {
      this.publish({
        message: "Could not load pinned threads",
        status: "error",
        value: this.snapshot().value,
      });
    }
  }

  isPinned(savedServerId: SavedServerId, threadId: ThreadId): boolean {
    return this.snapshot().value.get(savedServerId)?.has(threadId) === true;
  }

  async setPinned(
    savedServerId: SavedServerId,
    threadId: ThreadId,
    pinned: boolean,
  ): Promise<void> {
    if (this.isPinned(savedServerId, threadId) === pinned) return;
    await this.#store.setPinned(savedServerId, threadId, pinned);
    this.#publishPin(savedServerId, threadId, pinned);
  }

  async deleteSavedServer(savedServerId: SavedServerId): Promise<void> {
    await this.#store.deleteSavedServer(savedServerId);
    const current = this.snapshot().value;
    if (!current.has(savedServerId)) return;
    // A new outer identity is required to notify useSyncExternalStore consumers.
    const next = new Map(current);
    next.delete(savedServerId);
    this.publish({ status: "ready", value: next });
  }

  #publishPin(savedServerId: SavedServerId, threadId: ThreadId, pinned: boolean): void {
    const current = this.snapshot().value;
    // Copy only the changed server partition so unchanged pin identities stay stable.
    const next = new Map(current);
    const serverPins = new Set(current.get(savedServerId));
    if (pinned) serverPins.add(threadId);
    else serverPins.delete(threadId);
    if (serverPins.size === 0) next.delete(savedServerId);
    else next.set(savedServerId, serverPins);
    this.publish({ status: "ready", value: next });
  }
}
