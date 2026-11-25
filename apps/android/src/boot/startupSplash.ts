import { hide, preventAutoHideAsync } from "expo-splash-screen";
import { Platform } from "react-native";

import { appLogger } from "../observability/logger";

let dismissed = false;

/** Claims the native launch screen before the router registers the root. */
export function holdStartupSplash(): void {
  void preventAutoHideAsync().catch((error: unknown) => {
    appLogger.warnCaught({ error, event: "startup.splash.hold_failed" });
  });
}

function dismissStartupSplash(): void {
  if (!dismissed) {
    hide();
    dismissed = true;
  }
}

/** Android observes the mounted native view during pre-draw. Other hosts use their layout event. */
export const startupSurfaceProps =
  Platform.OS === "android"
    ? { nativeID: "codewide-startup-surface" }
    : { onLayout: dismissStartupSplash };
