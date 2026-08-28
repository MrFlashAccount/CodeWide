import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import type { SyncEvent, SyncSnapshotThread } from "@codewide/sync-client";

import { operationalDiagnosticsEnabled, recordDiagnosticTiming } from "./operational-metrics";

export type ProjectedThreadChange = {
  before: Thread;
  after: Thread;
};

export type ThreadEventProjection = {
  checkpoint: Promise<void>;
  /** Loaded threads touched by this event batch. Downstream projections consume
   * these snapshots instead of rematerializing the persisted collection. */
  threads: ReadonlyMap<string, ProjectedThreadChange>;
};

export type ThreadProjectionStore = {
  applySnapshot(connectionId: string, snapshots: SyncSnapshotThread[], cursor: number): Promise<void>;
  applyEvents(connectionId: string, events: SyncEvent[]): Promise<ThreadEventProjection>;
};

type ThreadProjectionAdapters = {
  summaries: Omit<ThreadProjectionStore, "applyEvents"> & {
    applyEvents(connectionId: string, events: SyncEvent[]): Promise<void>;
  };
  details: ThreadProjectionStore;
  reconcileBeforeSummary?(
    connectionId: string,
    events: SyncEvent[],
    projected: ThreadEventProjection,
  ): Promise<ThreadEventProjection>;
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
      const measureDiagnostics = operationalDiagnosticsEnabled();
      const detailStartedAt = measureDiagnostics ? performance.now() : 0;
      try {
        await adapters.details.applySnapshot(connectionId, snapshots, cursor);
      } finally {
        if (measureDiagnostics) recordDiagnosticTiming("thread_detail_projection_ms", performance.now() - detailStartedAt);
      }
      const summaryStartedAt = measureDiagnostics ? performance.now() : 0;
      try {
        await adapters.summaries.applySnapshot(connectionId, snapshots, cursor);
      } finally {
        if (measureDiagnostics) recordDiagnosticTiming("thread_summary_projection_ms", performance.now() - summaryStartedAt);
      }
    },
    async applyEvents(connectionId, events) {
      const measureDiagnostics = operationalDiagnosticsEnabled();
      const detailStartedAt = measureDiagnostics ? performance.now() : 0;
      let projected: ThreadEventProjection;
      try {
        projected = await adapters.details.applyEvents(connectionId, events);
        // `applyEvents` updates the resident Legend projection synchronously,
        // while its durable SQLite checkpoint may complete later. A terminal
        // summary must not become visible before that checkpoint or lifecycle
        // and final TURN content can describe two different journal positions.
        await projected.checkpoint;
        projected = await adapters.reconcileBeforeSummary?.(connectionId, events, projected) ?? projected;
      } finally {
        if (measureDiagnostics) recordDiagnosticTiming("thread_detail_projection_ms", performance.now() - detailStartedAt);
      }
      const summaryStartedAt = measureDiagnostics ? performance.now() : 0;
      try {
        await adapters.summaries.applyEvents(connectionId, events);
      } finally {
        if (measureDiagnostics) recordDiagnosticTiming("thread_summary_projection_ms", performance.now() - summaryStartedAt);
      }
      return projected;
    },
  };
}
