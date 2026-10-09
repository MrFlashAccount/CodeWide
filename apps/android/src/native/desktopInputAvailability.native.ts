import { UIManager } from "react-native";

function buttonsAvailable(configuration: unknown): boolean {
  if (
    typeof configuration !== "object" ||
    configuration === null ||
    !("Constants" in configuration)
  ) {
    return false;
  }
  const constants = configuration.Constants;
  return (
    typeof constants === "object" &&
    constants !== null &&
    "mouseButtonsAvailable" in constants &&
    constants.mouseButtonsAvailable === true
  );
}

/** Exposes controls only when the APK and firmware support native mouse button delivery. */
export const desktopInputAvailable = buttonsAvailable(
  UIManager.getViewManagerConfig("CodeWideDesktopInput"),
);
