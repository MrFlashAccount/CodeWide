import {
  OVERVIEW_SNAPSHOT_PREFIX,
  RETAINED_OVERVIEW_SNAPSHOTS,
  type ForgeSnapshotCache,
} from "./forgeSnapshotCache.types";

const entries = new Map<string, Map<string, unknown>>();

function connectionEntries(connectionId: string): Map<string, unknown> {
  let current = entries.get(connectionId);
  if (current === undefined) {
    current = new Map();
    entries.set(connectionId, current);
  }
  return current;
}

/** Process-local web fallback; insertion order doubles as recency for eviction. */
export const forgeSnapshotCache: ForgeSnapshotCache = {
  async deleteConnection(connectionId) {
    entries.delete(connectionId);
    await Promise.resolve();
  },
  async read(connectionId, key) {
    await Promise.resolve();
    return entries.get(connectionId)?.get(key) ?? null;
  },
  async write(connectionId, key, value) {
    const current = connectionEntries(connectionId);
    current.delete(key);
    current.set(key, value);
    const overviews = [...current.keys()].filter((entry) =>
      entry.startsWith(OVERVIEW_SNAPSHOT_PREFIX),
    );
    for (const stale of overviews.slice(
      0,
      Math.max(0, overviews.length - RETAINED_OVERVIEW_SNAPSHOTS),
    )) {
      current.delete(stale);
    }
    await Promise.resolve();
  },
};
