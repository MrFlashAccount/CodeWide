import { AppState, type AppStateStatus } from "react-native";
import { appLogger } from "../observability/logger";
import { wakeNativeConnection } from "../native/native-transport";
import { recordOperationalTelemetryEvent } from "./telemetry";
/** Existing active/focus wake and repair subscriptions; replacement preserves cleanup. */
export function createCatalogLifecycle({
  enabledConnectionIds,
  refreshThreadCatalog,
}: {
  enabledConnectionIds: () => string[];
  refreshThreadCatalog: (connectionId: string) => Promise<void>;
}) {
  let catalogRepairTimer: ReturnType<typeof setInterval> | null = null;
  let catalogLifecycleSubscriptions: Array<{ remove: () => void }> = [];
  return (repairForegroundConnection: (connectionId: string) => Promise<void>): void => {
    const repairCatalogs = (): void => {
      for (const connectionId of enabledConnectionIds()) {
        wakeNativeConnection(connectionId);
        void refreshThreadCatalog(connectionId).catch(() => {
          appLogger.warn({
            event: "thread_catalog.lifecycle_repair.failed",
            fields: { connectionId },
          });
        });
      }
    };
    const repairForegroundRuntime = (state: AppStateStatus): void => {
      for (const connectionId of enabledConnectionIds()) {
        recordOperationalTelemetryEvent(connectionId, { name: "app.lifecycle", tags: { state } });
      }
      if (state !== "active") {
        return;
      }
      for (const connectionId of enabledConnectionIds()) {
        void repairForegroundConnection(connectionId).catch(() => {
          appLogger.warn({
            event: "connection.foreground_repair.failed",
            fields: { connectionId },
          });
        });
      }
    };
    const wakeFocusedConnections = (): void => {
      for (const connectionId of enabledConnectionIds()) {
        recordOperationalTelemetryEvent(connectionId, { name: "app.window_focus" });
      }
      // Focus also fires for transient Android overlays, often beside active.
      // Waking transport is cheap; only active owns foreground data repair.
      for (const connectionId of enabledConnectionIds()) {
        wakeNativeConnection(connectionId);
      }
    };
    for (const subscription of catalogLifecycleSubscriptions) {
      subscription.remove();
    }
    catalogLifecycleSubscriptions = [
      AppState.addEventListener("focus", wakeFocusedConnections),
      AppState.addEventListener("change", repairForegroundRuntime),
    ];
    if (catalogRepairTimer !== null) {
      clearInterval(catalogRepairTimer);
    }
    catalogRepairTimer = setInterval(() => {
      if (AppState.currentState === "active") {
        repairCatalogs();
      }
    }, THREAD_CATALOG_REPAIR_TICK_MS);
    repairCatalogs();
  };
}
const THREAD_CATALOG_REPAIR_TICK_MS = 60 * 1000;
