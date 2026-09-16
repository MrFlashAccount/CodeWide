import { StyleSheet } from "react-native";
import { colors, radii, spacing, typeScale } from "../../../theme";

export const styles = StyleSheet.create({
  turnMetaText: {
    color: colors.textMuted,
    ...typeScale.caption,
  },
  turnStatusCompleted: { backgroundColor: colors.green },
  turnStatusDot: {
    borderRadius: radii.pill,
    height: 7,
    width: 7,
  },
  turnStatusFailed: { backgroundColor: colors.red },
  turnStatusStopped: { backgroundColor: colors.textDim },
  turnTokenMetrics: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xxs,
  },
});
