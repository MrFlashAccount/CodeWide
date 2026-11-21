import { Platform, requireNativeComponent, UIManager, type ViewProps } from "react-native";

const manager = "CodeWidePaneSnapshot";

/** Android drawing surface when available in the installed native runtime. */
export const NativePaneSnapshot =
  Platform.OS === "android" && UIManager.hasViewManagerConfig(manager)
    ? requireNativeComponent<
        ViewProps & { readonly canvasColor: string; readonly keepScrollEnd: boolean }
      >(manager)
    : null;
