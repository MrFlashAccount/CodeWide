import { I18nManager, Platform, UIManager } from "react-native";

export const COMPLETED_FOOTER_NAME = "CodeWideCompletedFooter";

/** Previous Android runtimes and right-to-left layouts retain the adaptive footer. */
export function supportsCompletedFooter(): boolean {
  return (
    Platform.OS === "android" &&
    !I18nManager.isRTL &&
    UIManager.hasViewManagerConfig(COMPLETED_FOOTER_NAME)
  );
}
