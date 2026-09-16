import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import type { SyncEvent, SyncSnapshotThread } from "@codewide/sync-client";
import { unknownRecord } from "./unknownRecord";

import { operationalDiagnosticsEnabled, recordDiagnosticTiming } from "./operational-metrics";

export type ProjectedThreadChange = {
  after: Thread;
  before: Thread;
};

export type ThreadEventProjection = {
  checkpoint: Promise<void>;
  /** Loaded threads touched by this event batch. Downstream projections consume
   * these snapshots instead of rematerializing the persisted collection. */
  threads: ReadonlyMap<string, ProjectedThreadChange>;
};

export type ThreadProjectionStore = {
  applyEvents: (connectionId: string, events: SyncEvent[]) => Promise<ThreadEventProjection>;
  applySnapshot: (
    connectionId: string,
    snapshots: SyncSnapshotThread[],
    cursor: number,
  ) => Promise<void>;
};

type ThreadProjectionAdapters = {
  details: ThreadProjectionStore;
  summaries: Omit<ThreadProjectionStore, "applyEvents"> & {
    applyEvents: (connectionId: string, events: SyncEvent[]) => Promise<void>;
  };
};

function normalizePersistedSnapshots(snapshots: SyncSnapshotThread[]): SyncSnapshotThread[] {
  let normalizedSnapshots: SyncSnapshotThread[] | undefined;

  for (let index = 0; index < snapshots.length; index += 1) {
    const snapshot = snapshots[index];
    if (snapshot === undefined) {
      continue;
    }
    if (hasPersistedSnapshotTurns(snapshot)) {
      normalizedSnapshots?.push(snapshot);
      continue;
    }

    normalizedSnapshots ??= snapshots.slice(0, index);
    // Native snapshots survive JS bundle upgrades. Older metadata-only rows did
    // not persist `turns`, so copy only this malformed row at the cache boundary.
    normalizedSnapshots.push({
      ...snapshot,
      thread: {
        ...snapshot.thread,
        turns: [],
      },
    });
  }

  return normalizedSnapshots ?? snapshots;
}

function hasPersistedSnapshotTurns(snapshot: SyncSnapshotThread): boolean {
  const turns = unknownRecord(snapshot.thread)?.turns;
  if (turns === undefined) {
    return false;
  }
  if (!Array.isArray(turns)) {
    throw new Error("Thread snapshot has invalid turns");
  }
  return true;
}

/**
 * The single ordered seam between native frames and persisted thread views.
 * Detail is committed first so a terminal summary never outruns the selected
 * thread's lifecycle projection. Native acknowledgement happens only after
 * both durable Adapter commits resolve.
 */
export function createThreadProjectionStore(
  adapters: ThreadProjectionAdapters,
): ThreadProjectionStore {
  return {
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
      } finally {
        if (measureDiagnostics) {
          recordDiagnosticTiming(
            "thread_detail_projection_ms",
            performance.now() - detailStartedAt,
          );
        }
      }
      const summaryStartedAt = measureDiagnostics ? performance.now() : 0;
      try {
        await adapters.summaries.applyEvents(connectionId, events);
      } finally {
        if (measureDiagnostics) {
          recordDiagnosticTiming(
            "thread_summary_projection_ms",
            performance.now() - summaryStartedAt,
          );
        }
      }
      return projected;
    },
    async applySnapshot(connectionId, snapshots, cursor) {
      const normalizedSnapshots = normalizePersistedSnapshots(snapshots);
      const measureDiagnostics = operationalDiagnosticsEnabled();
      const detailStartedAt = measureDiagnostics ? performance.now() : 0;
      try {
        await adapters.details.applySnapshot(connectionId, normalizedSnapshots, cursor);
      } finally {
        if (measureDiagnostics) {
          recordDiagnosticTiming(
            "thread_detail_projection_ms",
            performance.now() - detailStartedAt,
          );
        }
      }
      const summaryStartedAt = measureDiagnostics ? performance.now() : 0;
      try {
        await adapters.summaries.applySnapshot(connectionId, normalizedSnapshots, cursor);
      } finally {
        if (measureDiagnostics) {
          recordDiagnosticTiming(
            "thread_summary_projection_ms",
            performance.now() - summaryStartedAt,
          );
        }
      }
    },
  };
}
