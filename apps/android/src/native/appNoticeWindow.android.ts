import { NativeModules } from "react-native";

interface AppNoticeWindowBridge {
  readonly setVisible: (visible: boolean) => void;
}

function isAppNoticeWindowBridge(value: unknown): value is AppNoticeWindowBridge {
  return (
    value !== null &&
    typeof value === "object" &&
    "setVisible" in value &&
    typeof value.setVisible === "function"
  );
}

/** Controls the application-attached toast window on Android. */
export function setAppNoticeWindowVisible(visible: boolean): void {
  const bridge = getAppNoticeWindowBridge();
  if (isAppNoticeWindowBridge(bridge)) {
    bridge.setVisible(visible);
  }
}

/** Keeps OTA bundles usable on APKs that predate the notice window module. */
export function isAppNoticeWindowAvailable(): boolean {
  return isAppNoticeWindowBridge(getAppNoticeWindowBridge());
}

function getAppNoticeWindowBridge(): unknown {
  return NativeModules.AppNoticeWindow;
}
