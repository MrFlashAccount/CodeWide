import { StyleSheet } from "react-native";
import { spacing } from "../../../theme";

export const styles = StyleSheet.create({
  livePlanFloat: {
    alignItems: "center",
    bottom: spacing.sm,
    flexDirection: "row",
    // The bottom inset reserves one row; chips shrink instead of wrapping over content.
    flexWrap: "nowrap",
    gap: spacing.xs,
    justifyContent: "center",
    left: 0,
    paddingHorizontal: spacing.sm,
    position: "absolute",
    right: 0,
    zIndex: 10,
  },
  timelineShell: { flex: 1 },
});
