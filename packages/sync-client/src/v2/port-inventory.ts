import type { V2ServerFrame } from "./frames";

/** Ephemeral server inventory. Reconnect clears authority until a new snapshot arrives. */
export type V2PortInventory = Extract<V2ServerFrame, { type: "portInventory" }>;

/** Latest-value resource; port updates never wait for the message projection apply chain. */
export class V2PortInventoryStore {
  #value: V2PortInventory | null = null;
  readonly #listeners = new Set<() => void>();

  getSnapshot(): V2PortInventory | null {
    return this.#value;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  publish(value: V2PortInventory): void {
    if (this.#value?.epochId === value.epochId && BigInt(value.revision) <= BigInt(this.#value.revision)) return;
    this.#value = value;
    this.#notify();
  }

  clear(): void {
    if (this.#value === null) return;
    this.#value = null;
    this.#notify();
  }

  #notify(): void {
    for (const listener of this.#listeners) {
      try { listener(); } catch {
        // A consumer cannot interrupt committed inventory or socket processing.
      }
    }
  }
}
