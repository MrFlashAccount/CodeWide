import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../../../theme";

export const styles = StyleSheet.create({
  bubbleNestedSurface: { backgroundColor: "transparent" },
  cardTitle: {
    color: colors.text,
    flexShrink: 1,
    minWidth: 0,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  tokenMetric: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xxs,
  },
  tokenMetrics: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xxs,
    justifyContent: "flex-end",
  },
  tokenMetricValue: {
    color: colors.textMuted,
    ...typeScale.caption,
    fontWeight: typeWeight.semibold,
  },
  tokenStrip: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.medium,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
  },
  tokenStripTitle: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.compact,
  },
});
