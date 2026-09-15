import { StyleSheet } from "react-native";
import { colors, controlSize, spacing, typeScale, typeTracking, typeWeight } from "../../../theme";

export const styles = StyleSheet.create({
  outputFootprintMetric: {
    flexShrink: 0,
    justifyContent: "center",
  },
  outputFootprintMetricText: {
    color: colors.textDim,
    ...typeScale.caption,
    fontVariant: ["tabular-nums"],
  },
  commandActivitySection: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    gap: spacing.xxs,
  },
  commandActivitySectionHeader: {
    minHeight: controlSize.compact,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.compact,
  },
  commandActivitySectionLabel: {
    color: colors.textMuted,
    ...typeScale.caption,
    fontWeight: typeWeight.semibold,
    textTransform: "uppercase",
    letterSpacing: typeTracking.caps,
  },
  turnMetaText: {
    color: colors.textMuted,
    ...typeScale.caption,
  },
  menuNotice: {
    color: colors.textMuted,
    ...typeScale.body,
    paddingVertical: spacing.xs,
  },
  errorText: {
    color: colors.red,
    ...typeScale.body,
  },
});
