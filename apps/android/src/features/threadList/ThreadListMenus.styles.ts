import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, touchTarget } from "../../theme";

export const styles = StyleSheet.create({
  headerIcon: {
    alignItems: "center",
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  pressed: { opacity: 0.68 },
  threadFilterActiveDot: {
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    height: 6,
    position: "absolute",
    right: spacing.xs,
    top: spacing.xs,
    width: 6,
  },
  threadFilterButton: {
    alignItems: "center",
    borderRadius: radii.large,
    flexShrink: 0,
    justifyContent: "center",
    minHeight: controlSize.touch,
    position: "relative",
    width: controlSize.touch,
  },
});
