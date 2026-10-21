/**
 * Device-side offline snapshot of forge reads: the PR list per category and the
 * most recently opened overviews. Neither is authoritative; readers re-validate
 * the stored JSON with the wire parsers and show its age.
 */
export type ForgeSnapshotCache = {
  /** Removes every snapshot of a deleted connection. */
  readonly deleteConnection: (connectionId: string) => Promise<void>;
  /** Returns the stored JSON value, or `null` when absent or unreadable. */
  readonly read: (connectionId: string, key: string) => Promise<unknown>;
  /** Stores one JSON-serializable value; overview entries beyond the bound are evicted. */
  readonly write: (connectionId: string, key: string, value: unknown) => Promise<void>;
};

/** Number of overview snapshots retained per connection. */
export const RETAINED_OVERVIEW_SNAPSHOTS = 10;

/** Key prefix of overview snapshots, which are bounded; list snapshots are not. */
export const OVERVIEW_SNAPSHOT_PREFIX = "overview\u0000";
