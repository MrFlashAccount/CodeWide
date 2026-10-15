import { StyleSheet } from "react-native";
import { colors, controlSize, spacing, typeScale, typeTracking, typeWeight } from "../../../theme";

const PRESSED_OPACITY = 0.72;

export const styles = StyleSheet.create({
  backgroundTaskButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: controlSize.compact,
  },
  backgroundTaskLabel: {
    color: colors.textMuted,
    ...typeScale.label,
  },
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
  pressed: {
    opacity: PRESSED_OPACITY,
  },
  turnMetaText: {
    color: colors.textMuted,
    ...typeScale.caption,
  },
});
