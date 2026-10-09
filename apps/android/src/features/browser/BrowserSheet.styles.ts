import { StyleSheet } from "react-native";
import { colors, controlSize, layoutSize, radii, spacing } from "../../theme";

const GRIP_TOUCH_WIDTH = layoutSize.header + layoutSize.header;

export const styles = StyleSheet.create({
  grip: {
    alignItems: "center",
    height: spacing.sm,
    justifyContent: "center",
    width: GRIP_TOUCH_WIDTH,
  },
  gripMark: {
    backgroundColor: colors.textDim,
    borderRadius: radii.pill,
    height: spacing.xxs,
    width: controlSize.touch - spacing.xxs,
  },
  gripRail: {
    alignItems: "center",
    backgroundColor: colors.surface,
    flexShrink: 0,
  },
  nativeHost: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  nativeSurface: {
    backgroundColor: colors.background,
    flex: 1,
    minHeight: 0,
  },
  surface: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.medium,
    borderTopRightRadius: radii.medium,
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
  },
});
