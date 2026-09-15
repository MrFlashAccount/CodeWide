import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, touchTarget } from "../../theme";

export const styles = StyleSheet.create({
  pressed: { opacity: 0.68 },
  headerIcon: {
    width: touchTarget,
    height: touchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.large,
  },
  threadFilterButton: {
    width: controlSize.touch,
    minHeight: controlSize.touch,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.large,
    position: "relative",
  },
  threadFilterActiveDot: {
    position: "absolute",
    top: spacing.xs,
    right: spacing.xs,
    width: 6,
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
});
