import { StyleSheet } from "react-native";
import { spacing } from "../../../theme";
export const styles = StyleSheet.create({
  timelineShell: { flex: 1 },
  livePlanFloat: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: spacing.sm,
    zIndex: 10,
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
});
