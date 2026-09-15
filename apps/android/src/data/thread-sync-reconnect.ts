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
  sync,
  catalog,
  details,
  accountRateLimits,
  refreshAccountRateLimits,
}: {
  sync: Pick<
    ReturnType<typeof createThreadSyncRuntime>,
    "invalidateHistoryReads" | "desiredThreadId" | "readThread"
  >;
  catalog: Pick<ReturnType<typeof createCatalogRuntime>, "refreshThreadCatalog">;
  details: Pick<ThreadDetailDatabase, "invalidateHistoryExhaustion">;
  accountRateLimits: Pick<AccountRateLimitsDatabase, "get">;
  refreshAccountRateLimits: ReturnType<typeof createAccountRateLimitsLoader>;
}): (row: ConnectionStateRow) => void {
  return (row) => {
    sync.invalidateHistoryReads(row.connectionId);
    details.invalidateHistoryExhaustion(row.connectionId);
    recordConnectionUsability(row);
    if (row.state === "live" && row.rpcAvailable) {
      void flushTelemetry();
      const desiredThreadId = sync.desiredThreadId(row.connectionId);
      if (desiredThreadId !== undefined) {
        void sync
          .readThread(row.connectionId, desiredThreadId, undefined, true)
          .catch((cause: unknown) => {
            console.warn("Thread sync failed after reconnect", cause);
          });
      }
      void catalog.refreshThreadCatalog(row.connectionId).catch((cause: unknown) => {
        console.warn("Thread catalog repair failed after connection became live", cause);
      });
      if (accountRateLimitsStale(accountRateLimits.get(row.connectionId))) {
        void refreshAccountRateLimits(row.connectionId).catch(() => undefined);
      }
    }
  };
}
