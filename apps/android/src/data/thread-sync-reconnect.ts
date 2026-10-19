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

/**
 * Repairs once per stable RPC recovery and once per new list-stream socket
 * generation; presentation and OS facts cannot invalidate reads. The repair
 * re-reads every open catalog window after the stream visibility is declared.
 */
export function createThreadSyncReconnect({
  catalog,
  details,
  readConnection,
  refreshAccountRateLimits,
  refreshAgentProviders,
  sync,
}: {
  catalog: Pick<ReturnType<typeof createCatalogRuntime>, "refreshVisibleCatalog">;
  details: Pick<ThreadDetailDatabase, "invalidateHistoryExhaustion">;
  readConnection: (connectionId: string) => ConnectionStateRow | undefined;
  refreshAccountRateLimits: ReturnType<typeof createAccountRateLimitsLoader>;
  /**
   * The server's provider list: its providers' sign-ins and limits and the
   * account pool's owner, which the accounts menu needs without opening the
   * server's settings page first.
   */
  refreshAgentProviders: (connectionId: string) => Promise<void>;
  sync: Pick<
    ReturnType<typeof createThreadSyncRuntime>,
    "invalidateHistoryReads" | "desiredThreadId" | "readThread"
  >;
}): {
  readonly accept: (row: ConnectionStateRow) => void;
  readonly close: () => void;
  readonly observeGeneration: (connectionId: string, generation: number) => void;
} {
  const recoveries = new Map<string, Recovery>();
  const generations = new Map<string, number>();
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
    void catalog.refreshVisibleCatalog(connectionId).catch(() => {
      appLogger.warn({
        event: "thread_catalog.reconnect_repair.failed",
        fields: { connectionId },
      });
    });
    void refreshAccountRateLimits(connectionId, true).catch(() => undefined);
    // A failure stays in the resource's state; an older Companion reads as unsupported.
    void refreshAgentProviders(connectionId).catch(() => undefined);
  };
  const scheduleRepair = (connectionId: string): void => {
    cancelRecovery(recoveries.get(connectionId));
    const recovery: Recovery = { status: "usable", timer: null };
    recoveries.set(connectionId, recovery);
    recovery.timer = setTimeout(() => {
      recovery.timer = null;
      const current = readConnection(connectionId);
      if (!closed && current?.enabled === true && current.rpcAvailable) {
        repair(connectionId);
      }
    }, RPC_STABILITY_MS);
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
      scheduleRepair(row.connectionId);
    },
    close(): void {
      closed = true;
      for (const recovery of recoveries.values()) {
        cancelRecovery(recovery);
      }
      recoveries.clear();
    },
    /**
     * A new socket generation forgot the stream's cursor map, so its rows must
     * be re-read even when RPC never looked unusable to this owner.
     */
    observeGeneration(connectionId: string, generation: number): void {
      const previous = generations.get(connectionId);
      generations.set(connectionId, generation);
      if (
        closed ||
        previous === undefined ||
        previous === generation ||
        recoveries.get(connectionId)?.status !== "usable"
      ) {
        return;
      }
      scheduleRepair(connectionId);
    },
  };
}
