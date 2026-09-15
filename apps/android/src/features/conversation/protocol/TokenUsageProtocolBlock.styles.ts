import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../../../theme";

export const styles = StyleSheet.create({
  bubbleNestedSurface: { backgroundColor: "transparent" },
  cardTitle: {
    minWidth: 0,
    flexShrink: 1,
    color: colors.text,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  tokenStrip: {
    minHeight: controlSize.regular,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
    borderRadius: radii.medium,
    backgroundColor: colors.surfaceContainerLow,
  },
  tokenStripTitle: { flexDirection: "row", alignItems: "center", gap: spacing.compact },
  tokenMetrics: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.xxs,
  },
  tokenMetric: { flexDirection: "row", alignItems: "center", gap: spacing.xxs },
  tokenMetricValue: {
    color: colors.textMuted,
    ...typeScale.caption,
    fontWeight: typeWeight.semibold,
  },
});
