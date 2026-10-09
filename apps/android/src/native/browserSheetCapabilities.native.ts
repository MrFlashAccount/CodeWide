import { UIManager } from "react-native";

const configuration: unknown = UIManager.getViewManagerConfig("CodeWideBrowserSheetContent");

/** Older native shells retain the existing sheet until the browser touch boundary is installed. */
export const browserSheetContentAvailable =
  configuration !== null && typeof configuration === "object";
