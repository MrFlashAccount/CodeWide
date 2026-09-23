import { appLogger } from "../observability/logger";
import { accountRateLimitsStale } from "./account-rate-limits";
import type { AccountRateLimitsDatabase } from "./account-rate-limits-database";
import type { createAccountRateLimitsLoader } from "./account-rate-limits-loader";
import type { createCatalogRuntime } from "./catalog-runtime";
import { recordConnectionUsability } from "./connection-runtime";
import type { ConnectionStateRow } from "./connection-state-model";
import { flushTelemetry } from "./telemetry";
import type { ThreadDetailDatabase } from "./thread-detail-database";
import type { createThreadSyncRuntime } from "./thread-sync-runtime";
/** Reconnect invalidates old history authority before scheduling independent live repair. */
export function createThreadSyncReconnect({
  accountRateLimits,
  catalog,
  details,
  refreshAccountRateLimits,
  sync,
}: {
  accountRateLimits: Pick<AccountRateLimitsDatabase, "get">;
  catalog: Pick<ReturnType<typeof createCatalogRuntime>, "refreshThreadCatalog">;
  details: Pick<ThreadDetailDatabase, "invalidateHistoryExhaustion">;
  refreshAccountRateLimits: ReturnType<typeof createAccountRateLimitsLoader>;
  sync: Pick<
    ReturnType<typeof createThreadSyncRuntime>,
    "invalidateHistoryReads" | "desiredThreadId" | "readThread"
  >;
}): (row: ConnectionStateRow) => void {
  const refreshedLiveConnections = new Set<string>();
  return (row) => {
    sync.invalidateHistoryReads(row.connectionId);
    details.invalidateHistoryExhaustion(row.connectionId);
    recordConnectionUsability(row);
    if (row.state !== "live" || !row.rpcAvailable) {
      refreshedLiveConnections.delete(row.connectionId);
      return;
    }
    const forceAccountRefresh = !refreshedLiveConnections.has(row.connectionId);
    refreshedLiveConnections.add(row.connectionId);
    flushTelemetry().catch(() => undefined);
    const desiredThreadId = sync.desiredThreadId(row.connectionId);
    if (desiredThreadId !== undefined) {
      void sync.readThread(row.connectionId, desiredThreadId, undefined, true).catch(() => {
        appLogger.warn({
          event: "thread.reconnect_sync.failed",
          fields: { connectionId: row.connectionId, threadId: desiredThreadId },
        });
      });
    }
    void catalog.refreshThreadCatalog(row.connectionId).catch(() => {
      appLogger.warn({
        event: "thread_catalog.reconnect_repair.failed",
        fields: { connectionId: row.connectionId },
      });
    });
    if (forceAccountRefresh || accountRateLimitsStale(accountRateLimits.get(row.connectionId))) {
      void refreshAccountRateLimits(row.connectionId, forceAccountRefresh).catch(() => undefined);
    }
  };
}
