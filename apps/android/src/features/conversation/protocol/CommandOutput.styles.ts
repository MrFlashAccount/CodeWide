import { StyleSheet } from "react-native";
import { colors, controlSize, spacing, typeScale, typeTracking, typeWeight } from "../../../theme";

export const styles = StyleSheet.create({
  commandActivitySection: {
    gap: spacing.xxs,
    maxWidth: "100%",
    minWidth: 0,
    width: "100%",
  },
  commandActivitySectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.compact,
    justifyContent: "space-between",
    minHeight: controlSize.compact,
  },
  commandActivitySectionLabel: {
    color: colors.textMuted,
    ...typeScale.caption,
    fontWeight: typeWeight.semibold,
    letterSpacing: typeTracking.caps,
    textTransform: "uppercase",
  },
  errorText: {
    color: colors.red,
    ...typeScale.body,
  },
  menuNotice: {
    color: colors.textMuted,
    ...typeScale.body,
    paddingVertical: spacing.xs,
  },
  outputFootprintMetric: {
    flexShrink: 0,
    justifyContent: "center",
  },
  outputFootprintMetricText: {
    color: colors.textDim,
    ...typeScale.caption,
    fontVariant: ["tabular-nums"],
  },
  turnMetaText: {
    color: colors.textMuted,
    ...typeScale.caption,
  },
});
