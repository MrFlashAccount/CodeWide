import { batch, observable } from "@legendapp/state";
import {
  liveActivityChangeFromPatch,
  threadProjectionPatchFromEvent,
  type LiveActivity,
  type SyncEvent,
} from "@codewide/sync-client";

import type { ThreadProjectionStore } from "./thread-projection-store";
import { threadSummaryKey } from "./thread-summary-projection";

/**
 * What each running thread's agent is doing now, keyed by
 * `threadSummaryKey(connectionId, threadId)`. Process-lifetime and never
 * persisted: the Companion publishes every change and its clearing in the
 * journaled thread patches, so replay reconstructs it and a snapshot resets it.
 */
export const threadLiveActivity$ = observable<Record<string, LiveActivity>>({});

/** Applies the live activity changes an ordered event batch publishes. */
function ingestThreadLiveActivity(connectionId: string, events: readonly SyncEvent[]): void {
  batch(() => {
    for (const event of events) {
      const patch = threadProjectionPatchFromEvent(event.payload);
      const change = patch === null ? null : liveActivityChangeFromPatch(patch);
      if (patch === null || change === null) {
        continue;
      }
      const activity$ = threadLiveActivity$[threadSummaryKey(connectionId, patch.threadId)];
      if (change.type === "set") {
        activity$?.set(change.activity);
      } else {
        activity$?.delete();
      }
    }
  });
}

/** Forgets one connection's activity; its next snapshot starts from none. */
export function clearConnectionLiveActivity(connectionId: string): void {
  const prefix = threadSummaryKey(connectionId, "");
  batch(() => {
    for (const key of Object.keys(threadLiveActivity$.peek())) {
      if (key.startsWith(prefix)) {
        threadLiveActivity$[key]?.delete();
      }
    }
  });
}

/**
 * Adds the live activity to the ordered projection seam. Events reach it
 * after their durable projection, so the label never outruns the row's own
 * running state.
 */
export function createThreadLiveActivityProjection(
  projection: ThreadProjectionStore,
): ThreadProjectionStore {
  return {
    async applyEvents(connectionId, events) {
      const projected = await projection.applyEvents(connectionId, events);
      ingestThreadLiveActivity(connectionId, events);
      return projected;
    },
    async applySnapshot(connectionId, snapshots, cursor) {
      await projection.applySnapshot(connectionId, snapshots, cursor);
      clearConnectionLiveActivity(connectionId);
    },
  };
}
