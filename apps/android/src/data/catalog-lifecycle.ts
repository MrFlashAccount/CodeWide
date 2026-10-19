import { AppState, type AppStateStatus } from "react-native";
import { appLogger } from "../observability/logger";
import { wakeNativeConnection } from "../native/native-transport";
import { recordOperationalTelemetryEvent } from "./telemetry";

function appVisible(): boolean {
  return AppState.currentState === "active";
}

/** The visibility-ordered re-read and the AppState registration of the catalog owner. */
export type CatalogLifecycle = {
  readonly refreshVisibleCatalog: (connectionId: string) => Promise<void>;
  /** Installs AppState handlers, replacing earlier ones, and re-reads every connection. */
  readonly register: (repairForegroundConnection: (connectionId: string) => Promise<void>) => void;
};

/**
 * The only owner of thread-list stream visibility and of the rule that
 * re-reads catalog pages on reconnect and foreground. Visibility follows the
 * app: `active` shows the stream, `background` hides it. Every re-read starts
 * only after the visibility it relies on reached the connection service, so
 * the pages and later pushes cover every change between them. There is no
 * periodic repair: between re-reads the stream keeps rows current.
 */
export function createCatalogLifecycle({
  enabledConnectionIds,
  refreshThreadCatalog,
  setListStreamVisible,
}: {
  enabledConnectionIds: () => string[];
  refreshThreadCatalog: (connectionId: string) => Promise<void>;
  setListStreamVisible: (connectionId: string, visible: boolean) => Promise<void>;
}): CatalogLifecycle {
  let subscriptions: Array<{ remove: () => void }> = [];

  /** Declares the current visibility, then re-reads the connection's open windows and pins. */
  const refreshVisibleCatalog = async (connectionId: string): Promise<void> => {
    await setListStreamVisible(connectionId, appVisible());
    await refreshThreadCatalog(connectionId);
  };

  const hide = (connectionId: string): void => {
    setListStreamVisible(connectionId, false).catch(() => {
      appLogger.warn({ event: "thread_list_stream.hide.failed", fields: { connectionId } });
    });
  };

  const register = (repairForegroundConnection: (connectionId: string) => Promise<void>): void => {
    const repairForegroundRuntime = (state: AppStateStatus): void => {
      for (const connectionId of enabledConnectionIds()) {
        recordOperationalTelemetryEvent(connectionId, { name: "app.lifecycle", tags: { state } });
      }
      if (state === "background") {
        for (const connectionId of enabledConnectionIds()) {
          hide(connectionId);
        }
        return;
      }
      if (state !== "active") {
        return;
      }
      for (const connectionId of enabledConnectionIds()) {
        // The foreground repair re-reads every open window and pin after this.
        void setListStreamVisible(connectionId, true)
          .then(async () => repairForegroundConnection(connectionId))
          .catch(() => {
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
    for (const subscription of subscriptions) {
      subscription.remove();
    }
    subscriptions = [
      AppState.addEventListener("focus", wakeFocusedConnections),
      AppState.addEventListener("change", repairForegroundRuntime),
    ];
    for (const connectionId of enabledConnectionIds()) {
      wakeNativeConnection(connectionId);
      void refreshVisibleCatalog(connectionId).catch(() => {
        appLogger.warn({
          event: "thread_catalog.lifecycle_repair.failed",
          fields: { connectionId },
        });
      });
    }
  };

  return { refreshVisibleCatalog, register };
}
