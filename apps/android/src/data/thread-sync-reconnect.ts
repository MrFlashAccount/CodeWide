import { appLogger } from "../observability/logger";
import type { createAccountRateLimitsLoader } from "./account-rate-limits-loader";
import type { createCatalogRuntime } from "./catalog-runtime";
import { recordConnectionUsability } from "./connection-runtime";
import type { ConnectionStateRow } from "./connection-state-model";
import { flushTelemetry } from "./telemetry";
import type { ThreadDetailDatabase } from "./thread-detail-database";
import type { createThreadSyncRuntime } from "./thread-sync-runtime";

const RPC_STABILITY_MS = 1000;

type Recovery =
  | { readonly status: "unusable" }
  | { readonly status: "usable"; timer: ReturnType<typeof setTimeout> | null };

function recoveryStatus(row: ConnectionStateRow): Recovery["status"] {
  return row.enabled && row.rpcAvailable ? "usable" : "unusable";
}

function cancelRecovery(recovery: Recovery | undefined): void {
  if (recovery?.status === "usable" && recovery.timer !== null) {
    clearTimeout(recovery.timer);
  }
}

/** Repairs once per stable RPC recovery; presentation and OS facts cannot invalidate reads. */
export function createThreadSyncReconnect({
  catalog,
  details,
  readConnection,
  refreshAccountRateLimits,
  sync,
}: {
  catalog: Pick<ReturnType<typeof createCatalogRuntime>, "refreshThreadCatalog">;
  details: Pick<ThreadDetailDatabase, "invalidateHistoryExhaustion">;
  readConnection: (connectionId: string) => ConnectionStateRow | undefined;
  refreshAccountRateLimits: ReturnType<typeof createAccountRateLimitsLoader>;
  sync: Pick<
    ReturnType<typeof createThreadSyncRuntime>,
    "invalidateHistoryReads" | "desiredThreadId" | "readThread"
  >;
}): { readonly accept: (row: ConnectionStateRow) => void; readonly close: () => void } {
  const recoveries = new Map<string, Recovery>();
  let closed = false;
  const repair = (connectionId: string): void => {
    details.invalidateHistoryExhaustion(connectionId);
    flushTelemetry().catch(() => undefined);
    const desiredThreadId = sync.desiredThreadId(connectionId);
    if (desiredThreadId !== undefined) {
      void sync.readThread(connectionId, desiredThreadId, undefined, true).catch(() => {
        appLogger.warn({
          event: "thread.reconnect_sync.failed",
          fields: { connectionId, threadId: desiredThreadId },
        });
      });
    }
    void catalog.refreshThreadCatalog(connectionId).catch(() => {
      appLogger.warn({
        event: "thread_catalog.reconnect_repair.failed",
        fields: { connectionId },
      });
    });
    void refreshAccountRateLimits(connectionId, true).catch(() => undefined);
  };
  return {
    accept(row: ConnectionStateRow): void {
      if (closed) {
        return;
      }
      recordConnectionUsability(row);
      // RPC admission is independent of projection catch-up. Waiting for the
      // projected `live` state can deadlock a journal batch that needs this read.
      const status = recoveryStatus(row);
      const previous = recoveries.get(row.connectionId);
      if (previous?.status === status) {
        return;
      }
      cancelRecovery(previous);
      if (status === "unusable") {
        recoveries.set(row.connectionId, { status });
        if (previous?.status === "usable") {
          sync.invalidateHistoryReads(row.connectionId);
        }
        return;
      }
      const recovery: Recovery = { status, timer: null };
      recoveries.set(row.connectionId, recovery);
      recovery.timer = setTimeout(() => {
        recovery.timer = null;
        const current = readConnection(row.connectionId);
        if (!closed && current?.enabled === true && current.rpcAvailable) {
          repair(row.connectionId);
        }
      }, RPC_STABILITY_MS);
    },
    close(): void {
      closed = true;
      for (const recovery of recoveries.values()) {
        cancelRecovery(recovery);
      }
      recoveries.clear();
    },
  };
}
