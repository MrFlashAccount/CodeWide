import { Platform, requireNativeComponent, UIManager, type ViewProps } from "react-native";

const hostName = "CodeWidePerfettoViewer";
/** Official Perfetto viewer bundled with this Android runtime. */
export const PerfettoTimeline =
  Platform.OS === "android" && UIManager.hasViewManagerConfig(hostName)
    ? requireNativeComponent<ViewProps & { readonly sourceUri: string }>(hostName)
    : null;
