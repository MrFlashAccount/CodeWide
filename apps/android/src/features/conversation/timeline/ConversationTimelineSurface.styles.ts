import { StyleSheet } from "react-native";
import { spacing } from "../../../theme";

export const styles = StyleSheet.create({
  livePlanFloat: {
    alignItems: "center",
    bottom: spacing.sm,
    flexDirection: "row",
    flexWrap: "wrap",
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
