import { refreshForegroundReadModels } from "./foreground-read-models";
import { recordOperationalTelemetryEvent } from "./telemetry";
import { ThreadSyncLane } from "./thread-cursor-sync";
import type { ThreadReadOperation, ThreadSyncAuthority } from "./thread-sync-types";
import type { WorkspaceSyncSupervisor } from "./workspace-session";
/** A fresh foreground pass is serialized separately from ordinary detail reads. */
export function createThreadSyncForeground({
  desiredThreadId,
  readThread,
  refreshThreadCatalog,
}: {
  desiredThreadId(connectionId: string): string | undefined;
  readThread: ThreadReadOperation;
  refreshThreadCatalog: ThreadSyncAuthority["refreshThreadCatalog"];
}) {
  const foregroundRepairLane = new ThreadSyncLane<void>();
  return (supervisor: Pick<WorkspaceSyncSupervisor, "reattachRuntime">) => {
    const repairForegroundConnection = (connectionId: string): Promise<void> => {
      // Each foreground transition waits for its fresh pass, not for every
      // later transition that may arrive while that pass is running.
      return foregroundRepairLane.run(
        connectionId,
        async (): Promise<void> => {
          try {
            recordOperationalTelemetryEvent(connectionId, {
              name: "app.foreground_repair_started",
            });
            await supervisor.reattachRuntime(connectionId);
            await refreshForegroundReadModels(connectionId, {
              desiredThreadId: desiredThreadId,
              refreshCatalog: (id) => refreshThreadCatalog(id, true),
              async refreshThread(id, threadId) {
                // A read begun before backgrounding is not proof of current state.
                // An authoritative read queues a fresh pass after an older read.
                const startedAt = performance.now();
                recordOperationalTelemetryEvent(id, {
                  name: "chat.foreground_refresh_started",
                  threadId,
                });
                await readThread(id, threadId, undefined, true);
                // readThread also reconciles the native command ledger, including
                // receipt changes that arrived while JS was suspended.
                recordOperationalTelemetryEvent(id, {
                  name: "chat.foreground_refreshed",
                  threadId,
                  values: { durationMs: performance.now() - startedAt },
                });
              },
            });
          } finally {
            recordOperationalTelemetryEvent(connectionId, {
              name: "app.foreground_repair_finished",
            });
          }
        },
        "afterCurrent",
      );
    };
    return repairForegroundConnection;
  };
}
