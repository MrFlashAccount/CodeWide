import * as Updates from "expo-updates";
import { AppState } from "react-native";
import { appLogger } from "../observability/logger";

const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const RETRY_INTERVAL_MS = 30 * 1000;

/**
 * Prefetches signed JS bundles while the release APK is open.
 * Development builds use Metro Fast Refresh instead; release builds poll the
 * private update service and cache bundles for the next application launch.
 * Never reload the live runtime: it may own a draft or an unacknowledged send.
 */
let started = false;

export function startOtaPrefetchRuntime(): void {
  if (started || __DEV__ || !Updates.isEnabled) {
    return;
  }
  started = true;

  let checking = false;
  // Native launch never waits for the update service. Check asynchronously
  // after startup, then on foreground/retry; cached bundles remain launchable offline.
  let nextCheckAt = Date.now() + RETRY_INTERVAL_MS;

  const prefetch = async (force = false) => {
    if (checking || AppState.currentState !== "active") {
      return;
    }
    if (!force && Date.now() < nextCheckAt) {
      return;
    }
    checking = true;

    try {
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) {
        await Updates.fetchUpdateAsync();
      }
      nextCheckAt = Date.now() + CHECK_INTERVAL_MS;
    } catch {
      // Retry transient download failures without interrupting the live runtime.
      nextCheckAt = Date.now() + RETRY_INTERVAL_MS;
      // A broken update edge must never make the installed app unusable.
      appLogger.warn({ event: "ota.prefetch.failed" });
    }
    checking = false;
  };

  const startPrefetch = (force = false): void => {
    prefetch(force).catch(() => {
      checking = false;
      nextCheckAt = Date.now() + RETRY_INTERVAL_MS;
    });
  };

  setInterval(startPrefetch, RETRY_INTERVAL_MS);
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      startPrefetch(true);
    }
  });
}
