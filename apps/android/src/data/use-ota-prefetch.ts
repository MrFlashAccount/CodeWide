import * as Updates from "expo-updates";
import { AppState } from "react-native";

const CHECK_INTERVAL_MS = 30 * 60 * 1_000;
const RETRY_INTERVAL_MS = 30 * 1_000;

/**
 * Keeps the release APK on the latest signed JS bundle while it is open.
 * Development builds use Metro Fast Refresh instead; release builds poll the
 * private update service and reload only the JS runtime as soon as a bundle is
 * ready. Losing transient UI state is intentional for this development app.
 */
let started = false;

export function startOtaPrefetchRuntime(): void {
  if (started || __DEV__ || !Updates.isEnabled) return;
  started = true;

  let checking = false;
  let updateReady = false;
  // Native ON_LOAD owns the cold-start check. JS is the foreground/retry path,
  // so do not immediately duplicate the same request when the module loads.
  let nextCheckAt = Date.now() + RETRY_INTERVAL_MS;

  const prefetch = async (force = false) => {
      if (checking || AppState.currentState !== "active") return;
      // A downloaded update waiting for activation must bypass network
      // throttling. Otherwise one failed/inactive reload can strand the app on
      // the old bundle until the next 30-minute check.
      if (!updateReady && !force && Date.now() < nextCheckAt) return;
      checking = true;

      try {
        if (!updateReady) {
          const result = await Updates.checkForUpdateAsync();
          if (result.isAvailable) {
            const fetched = await Updates.fetchUpdateAsync();
            updateReady = fetched.isNew || fetched.isRollBackToEmbedded;
          }
          nextCheckAt = Date.now() + CHECK_INTERVAL_MS;
        }

        if (updateReady && AppState.currentState === "active") {
          // reloadAsync selects the freshly downloaded bundle and recreates
          // the JS runtime; it does not require killing the Android process.
          await Updates.reloadAsync();
        }
      } catch (error) {
        // Keep the pending activation flag and retry quickly after a transient
        // native/network failure. Successful no-update checks remain limited
        // to once per 30 minutes.
        nextCheckAt = Date.now() + RETRY_INTERVAL_MS;
        // A broken update edge must never make the installed app unusable.
        console.warn("[CodeWide] OTA live reload failed", error);
      }
      checking = false;
  };

  setInterval(() => void prefetch(), RETRY_INTERVAL_MS);
  AppState.addEventListener("change", (state) => {
    if (state === "active") void prefetch(true);
  });
}
