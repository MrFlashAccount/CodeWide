import type { SavedServerRepository } from "../../application/ports/savedServerRepository";

export function createSavedServerRepository(): SavedServerRepository {
  return {
    close: () => undefined,
    connection: () => Promise.reject(new Error("Saved servers are available on Android only")),
    delete: () => Promise.reject(new Error("Saved servers are available on Android only")),
    list: () => Promise.resolve([]),
    move: () => Promise.reject(new Error("Saved servers are available on Android only")),
    pair: () => Promise.reject(new Error("Pairing is available on Android only")),
    reconnect: () => undefined,
    setEnabled: () => Promise.reject(new Error("Saved servers are available on Android only")),
    subscribe: () => () => undefined,
    update: () => Promise.reject(new Error("Saved servers are available on Android only")),
  };
}
