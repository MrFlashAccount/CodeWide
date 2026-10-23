/**
 * Small connection-scoped key/value store for forge UI preferences. Remote
 * server state is persisted by TanStack Query and never mirrored here.
 */
export type ForgeSnapshotCache = {
  /** Removes every snapshot of a deleted connection. */
  readonly deleteConnection: (connectionId: string) => Promise<void>;
  /** Returns the stored JSON value, or `null` when absent or unreadable. */
  readonly read: (connectionId: string, key: string) => Promise<unknown>;
  /** Stores one JSON-serializable preference value. */
  readonly write: (connectionId: string, key: string, value: unknown) => Promise<void>;
};
