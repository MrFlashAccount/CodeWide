import { threadIdFromEvent, type SyncEvent, type ThreadProjectionPatchV1 } from "@codewide/sync-client";

export function latestThreadInvalidations(events: SyncEvent[]): Map<string, number> {
  const latest = new Map<string, number>();
  for (const event of events) {
    const threadId = threadIdFromEvent(event.payload);
    if (threadId === null) continue;
    latest.set(threadId, Math.max(latest.get(threadId) ?? -1, event.cursor));
  }
  return latest;
}

export function invalidationCanBeCleared(currentCursor: number, refreshStartCursor: number): boolean {
  return currentCursor <= refreshStartCursor;
}

export function shouldPersistThreadInvalidation(
  patch: ThreadProjectionPatchV1 | null,
  loaded: boolean,
  startedShell: boolean,
): boolean {
  return patch?.operation.kind === "threadInvalidated"
    || patch === null
    || (!loaded && !startedShell);
}

/**
 * Canonical rollout writes are only an invalidation source while a turn is
 * streaming. Re-reading its lossy summary over the live App Server projection
 * rotates item ids and can duplicate whole progress chains. Unknown threads
 * still get one lazy read so externally-created conversations materialize;
 * known hot threads refresh once the canonical turn is complete.
 */
export function shouldRefreshInvalidatedThread(
  known: boolean,
  loaded: boolean,
  turnActive: boolean,
): boolean {
  return !known || (loaded && !turnActive);
}
