import { Platform, PlatformColor, StyleSheet } from "react-native";
import { colors } from "../theme";
import { APP_SHEET_MAX_WIDTH } from "./appSheetGeometry";

// Material 3 BottomSheetDefaults uses SurfaceContainerLow from the dark system palette on Android.
const surfaceColor =
  Platform.OS === "android"
    ? PlatformColor("@android:color/system_surface_container_low_dark")
    : colors.surfaceContainerHigh;

/** Shared chrome for CodeWide's Reacticx trays. */
export const appTrayPalette = {
  backdrop: colors.scrim,
  handle: colors.textDim,
  mutedText: colors.textMuted,
  text: colors.text,
};

/** Matches the native bottom sheet surface and the shared maximum sheet width. */
export const appTrayStyles = StyleSheet.create({
  surface: {
    alignSelf: "center",
    backgroundColor: surfaceColor,
    borderColor: surfaceColor,
    maxWidth: APP_SHEET_MAX_WIDTH,
    width: "100%",
  },
});
