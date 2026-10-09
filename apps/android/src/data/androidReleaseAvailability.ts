import { observable, type Observable } from "@legendapp/state";
import { AppState, Platform } from "react-native";

import { appLogger } from "../observability/logger";
import {
  ANDROID_RELEASE_MANIFEST_URL,
  parseAndroidReleaseVersion,
  validateAndroidReleaseVersion,
  type AndroidReleaseAvailabilitySnapshot,
} from "./androidReleaseContract";

// WHY: Release polling intervals are explicit wall-clock process boundaries.
const CHECK_INTERVAL_MS = 21_600_000;
const RETRY_INTERVAL_MS = 300_000;
// WHY: A release inventory should stay tiny; this bounds untrusted response parsing.
const MANIFEST_MAX_LENGTH = 262_144;
// WHY: Startup never waits for GitHub, and a hung background request must release its resources.
const REQUEST_TIMEOUT_MS = 15_000;
type AndroidReleaseAvailabilityResource = {
  readonly refresh: (force?: boolean) => Promise<void>;
  readonly snapshot$: Observable<{ value: AndroidReleaseAvailabilitySnapshot }>;
};

type AndroidReleaseResourceOptions = {
  readonly loadLatestVersion: () => Promise<string>;
  readonly now?: () => number;
  readonly onError?: (error: unknown) => void;
};

function createAndroidReleaseAvailabilityResource(
  options: AndroidReleaseResourceOptions,
): AndroidReleaseAvailabilityResource {
  const now = options.now ?? Date.now;
  const snapshot$ = observable<{ value: AndroidReleaseAvailabilitySnapshot }>({
    value: { latestVersion: null, status: "idle" },
  });
  let nextCheckAt = 0;
  let pending: Promise<void> | null = null;

  return {
    async refresh(force = false) {
      if (pending !== null) {
        return pending;
      }
      if (!force && now() < nextCheckAt) {
        return;
      }
      const previous = snapshot$.value.peek();
      snapshot$.value.set({ latestVersion: previous.latestVersion, status: "loading" });
      pending = options
        .loadLatestVersion()
        .then((latestVersion) => {
          snapshot$.value.set({
            latestVersion: validateAndroidReleaseVersion(latestVersion),
            status: "ready",
          });
          nextCheckAt = now() + CHECK_INTERVAL_MS;
        })
        .catch((error: unknown) => {
          snapshot$.value.set({ latestVersion: previous.latestVersion, status: "error" });
          nextCheckAt = now() + RETRY_INTERVAL_MS;
          options.onError?.(error);
        })
        .finally(() => {
          pending = null;
        });
      return pending;
    },
    snapshot$,
  };
}

async function loadLatestAndroidReleaseVersion(): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(ANDROID_RELEASE_MANIFEST_URL, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`GitHub release manifest returned HTTP ${String(response.status)}`);
    }
    const text = await response.text();
    if (text.length > MANIFEST_MAX_LENGTH) {
      throw new Error("GitHub release manifest is too large");
    }
    const manifest: unknown = JSON.parse(text);
    return parseAndroidReleaseVersion(manifest);
  } finally {
    clearTimeout(timeout);
  }
}

/** Process-wide Android APK release availability consumed by the settings footer. */
export const androidReleaseAvailability = createAndroidReleaseAvailabilityResource({
  loadLatestVersion: loadLatestAndroidReleaseVersion,
  onError(error) {
    appLogger.warnCaught({ error, event: "android_release.check.failed" });
  },
});

let started = false;

/** Starts background release checks without delaying Android application startup. */
export function startAndroidReleaseCheckRuntime(): void {
  if (started || Platform.OS !== "android") {
    return;
  }
  started = true;
  const refresh = (force = false): void => {
    if (AppState.currentState === "active") {
      androidReleaseAvailability.refresh(force).catch(() => undefined);
    }
  };
  refresh(true);
  setInterval(refresh, RETRY_INTERVAL_MS);
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      refresh();
    }
  });
}
