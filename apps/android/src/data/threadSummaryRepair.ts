import {
  threadIdFromEvent,
  threadProjectionPatchFromEvent,
  type SyncEvent,
  type SyncSnapshotThread,
} from "@codewide/sync-client";
import { isCatalogExcluded } from "./threadCatalogMembership";
import { threadSummaryEventNeedsMetadata } from "./thread-summary-projection";
import type { ThreadSummaryDatabase } from "./thread-summary-database-contract";
import { threadSummaryProjectionCursor } from "./thread-summary-types";

type Repair = {
  readonly checkpoint: Promise<void>;
  readonly events: SyncEvent[];
};

type RepairPorts = {
  readonly readMetadata: (connectionId: string, threadId: string) => Promise<SyncSnapshotThread>;
  readonly summaries: Pick<ThreadSummaryDatabase, "applyEvents" | "applyRepairedEvents" | "get">;
};

function queuedSummaryRemoved(events: readonly SyncEvent[]): boolean {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event === undefined) {
      continue;
    }
    if (isCatalogExcluded(event.payload)) {
      return true;
    }
    const kind = threadProjectionPatchFromEvent(event.payload)?.operation.kind;
    if (kind === "threadDeleted") {
      return true;
    }
    if (kind === "threadStarted" || threadSummaryEventNeedsMetadata(event.payload)) {
      return false;
    }
  }
  return false;
}

/** Keeps missing-summary events in the native journal until metadata and replay are durable. */
export function createThreadSummaryRepair({ readMetadata, summaries }: RepairPorts) {
  const pending = new Map<string, Repair>();

  const repair = async (
    connectionId: string,
    threadId: string,
    events: SyncEvent[],
  ): Promise<void> => {
    const current = await summaries.get(connectionId, threadId);
    if (
      current !== null &&
      events.every((event) => event.cursor <= threadSummaryProjectionCursor(current))
    ) {
      events.length = 0;
    }
    if (current === null) {
      let snapshot: SyncSnapshotThread;
      try {
        snapshot = await readMetadata(connectionId, threadId);
      } catch (error: unknown) {
        // A concurrent authoritative removal does not require a readable shell.
        // Persist that removal rather than retrying a deleted thread forever.
        if (!queuedSummaryRemoved(events)) {
          throw error;
        }
        await summaries.applyEvents(connectionId, events.splice(0));
        return;
      }
      // Transfer this queued prefix to the database's atomic seed/replay transaction.
      await summaries.applyRepairedEvents(connectionId, snapshot, events.splice(0));
    }
    while (events.length > 0) {
      // New events may arrive during metadata loading or the durable checkpoint.
      // Replaying an already applied cursor is idempotent at the summary owner.
      await summaries.applyEvents(connectionId, events.splice(0));
    }
  };

  return async (connectionId: string, events: readonly SyncEvent[]): Promise<void> => {
    const checkpoints = new Set<Promise<void>>();
    for (const event of events) {
      const threadId = threadIdFromEvent(event.payload);
      if (threadId === null) {
        continue;
      }
      const key = `${connectionId}\u0000${threadId}`;
      const previous = pending.get(key);
      if (
        previous === undefined &&
        (isCatalogExcluded(event.payload) || !threadSummaryEventNeedsMetadata(event.payload))
      ) {
        continue;
      }
      if (previous !== undefined) {
        previous.events.push(event);
        checkpoints.add(previous.checkpoint);
        continue;
      }
      const queued = [event];
      const checkpoint = Promise.resolve()
        .then(async () => repair(connectionId, threadId, queued))
        .finally(() => {
          if (pending.get(key)?.checkpoint === checkpoint) {
            pending.delete(key);
          }
        });
      // A native acknowledgement may be queued after other projection effects.
      // Observe rejection immediately; the original checkpoint still rejects to block ACK.
      void checkpoint.catch(() => undefined);
      pending.set(key, { checkpoint, events: queued });
      checkpoints.add(checkpoint);
    }
    const checkpoint = Promise.all(checkpoints).then(() => undefined);
    void checkpoint.catch(() => undefined);
    return checkpoint;
  };
}
