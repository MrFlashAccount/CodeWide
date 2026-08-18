export type ChronologicalTimelineEntry<T> = {
  value: T;
  timestampMs: number | null;
};

/**
 * Inserts local outbox projections into the authoritative timeline without
 * moving remote rows. This closes the short handoff where a server turn can
 * arrive before its matching client id is projected back to the UI.
 */
export function mergeChronologicalTimeline<T>(
  remote: ChronologicalTimelineEntry<T>[],
  optimistic: ChronologicalTimelineEntry<T>[],
): T[] {
  if (optimistic.length === 0) return remote.map(({ value }) => value);
  const pending = optimistic
    .map((entry, index) => ({ ...entry, index }))
    .sort((left, right) => compareTimestamp(left.timestampMs, right.timestampMs) || left.index - right.index);
  const merged: T[] = [];
  let pendingIndex = 0;
  for (const entry of remote) {
    while (
      pendingIndex < pending.length
      && shouldInsertBeforeRemote(pending[pendingIndex]?.timestampMs ?? null, entry.timestampMs)
    ) {
      merged.push(pending[pendingIndex]!.value);
      pendingIndex += 1;
    }
    merged.push(entry.value);
  }
  while (pendingIndex < pending.length) {
    merged.push(pending[pendingIndex]!.value);
    pendingIndex += 1;
  }
  return merged;
}

export function protocolTimestampMs(timestamp: number | null): number | null {
  if (timestamp === null || !Number.isFinite(timestamp)) return null;
  return timestamp < 10_000_000_000 ? timestamp * 1_000 : timestamp;
}

function shouldInsertBeforeRemote(optimisticMs: number | null, remoteMs: number | null): boolean {
  if (optimisticMs === null || remoteMs === null) return false;
  return optimisticMs <= remoteMs;
}

function compareTimestamp(left: number | null, right: number | null): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return left - right;
}
