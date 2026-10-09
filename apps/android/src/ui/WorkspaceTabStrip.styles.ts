import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing } from "../theme";

const DISABLED_OPACITY = 0.4;

export const styles = StyleSheet.create({
  add: {
    alignItems: "center",
    borderRadius: radii.small,
    flexShrink: 0,
    height: controlSize.touch,
    justifyContent: "center",
    width: controlSize.touch,
  },
  compactAdd: {
    height: controlSize.regular,
    width: controlSize.regular,
  },
  compactList: { gap: 0 },
  compactRoot: { backgroundColor: colors.background },
  disabled: { opacity: DISABLED_OPACITY },
  list: {
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  pressed: { backgroundColor: colors.surfaceHover },
  root: {
    alignItems: "center",
    backgroundColor: colors.surface,
    flex: 1,
    flexDirection: "row",
    minWidth: 0,
  },
  scroll: {
    flex: 1,
    minWidth: 0,
  },
});
