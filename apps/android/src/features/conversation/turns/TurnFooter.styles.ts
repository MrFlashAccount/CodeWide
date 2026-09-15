import { StyleSheet } from "react-native";
import { colors, radii, spacing, typeScale } from "../../../theme";

export const styles = StyleSheet.create({
  turnTokenMetrics: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xxs,
  },
  turnStatusDot: {
    width: 7,
    height: 7,
    borderRadius: radii.pill,
  },
  turnStatusFailed: { backgroundColor: colors.red },
  turnStatusStopped: { backgroundColor: colors.textDim },
  turnStatusCompleted: { backgroundColor: colors.green },
  turnMetaText: {
    color: colors.textMuted,
    ...typeScale.caption,
  },
});
