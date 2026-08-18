import type { SyncEvent, SyncSnapshotThread } from "@codewide/sync-client";

export type ThreadProjectionStore = {
  applySnapshot(connectionId: string, snapshots: SyncSnapshotThread[], cursor: number): Promise<void>;
  applyEvents(connectionId: string, events: SyncEvent[]): Promise<void>;
};

type ThreadProjectionAdapters = {
  summaries: ThreadProjectionStore;
  details: ThreadProjectionStore;
};

/**
 * The single ordered seam between native frames and persisted thread views.
 * Detail is committed first so a terminal summary never outruns the selected
 * thread's lifecycle projection. Native acknowledgement happens only after
 * both durable Adapter commits resolve.
 */
export function createThreadProjectionStore(adapters: ThreadProjectionAdapters): ThreadProjectionStore {
  return {
    async applySnapshot(connectionId, snapshots, cursor) {
      await adapters.details.applySnapshot(connectionId, snapshots, cursor);
      await adapters.summaries.applySnapshot(connectionId, snapshots, cursor);
    },
    async applyEvents(connectionId, events) {
      await adapters.details.applyEvents(connectionId, events);
      await adapters.summaries.applyEvents(connectionId, events);
    },
  };
}
