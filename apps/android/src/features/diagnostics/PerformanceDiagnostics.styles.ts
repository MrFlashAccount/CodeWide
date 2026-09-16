import { StyleSheet } from "react-native";
import {
  colors,
  controlSize,
  layoutSize,
  radii,
  spacing,
  typeScale,
  typeWeight,
} from "../../theme";

export const styles = StyleSheet.create({
  abButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.medium,
    justifyContent: "center",
    minHeight: controlSize.compact,
    minWidth: controlSize.compact,
    paddingHorizontal: spacing.xs,
  },
  abButtonText: {
    color: colors.text,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  buttonDisabled: { opacity: 0.5 },
  chartCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.medium,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  chartEmpty: {
    color: colors.textDim,
    ...typeScale.label,
  },
  chartHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  chartSubtitle: {
    color: colors.textDim,
    marginTop: spacing.optical,
    ...typeScale.caption,
  },
  chartTitle: {
    color: colors.text,
    ...typeScale.title,
  },
  collecting: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: controlSize.touch,
  },
  counterText: {
    color: colors.textDim,
    ...typeScale.caption,
    fontVariant: ["tabular-nums"],
  },
  counterWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  diagnosticActionRow: {
    alignItems: "flex-end",
    gap: spacing.xs,
  },
  diagnosticsButtonRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    justifyContent: "flex-end",
  },
  error: {
    color: colors.red,
    ...typeScale.body,
  },
  experimentCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.medium,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  experimentCopy: {
    flex: 1,
    minWidth: 0,
  },
  experimentDescription: {
    color: colors.textMuted,
    ...typeScale.label,
  },
  experimentHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
  },
  experimentHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  experimentRow: {
    alignItems: "center",
    borderTopColor: colors.borderSoft,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: layoutSize.row,
    paddingTop: spacing.xs,
  },
  experimentTitle: {
    color: colors.text,
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
  },
  footnote: {
    color: colors.textDim,
    ...typeScale.caption,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  iconShell: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.medium,
    height: controlSize.regular,
    justifyContent: "center",
    width: controlSize.regular,
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    justifyContent: "flex-end",
  },
  legendDot: {
    borderRadius: radii.pill,
    height: 7,
    width: 7,
  },
  legendItem: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xxs,
  },
  legendLabel: {
    color: colors.textMuted,
    ...typeScale.caption,
  },
  memoryBreakdown: { gap: spacing.xs },
  memoryLabel: {
    color: colors.textMuted,
    ...typeScale.label,
    fontVariant: ["tabular-nums"],
  },
  memoryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  metricDetail: {
    color: colors.textDim,
    ...typeScale.label,
    fontVariant: ["tabular-nums"],
  },
  metricLabel: {
    color: colors.textMuted,
    ...typeScale.label,
  },
  metricTile: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.medium,
    flexGrow: 1,
    gap: spacing.optical,
    minWidth: 130,
    padding: spacing.sm,
    width: "48%",
  },
  metricValue: {
    color: colors.text,
    ...typeScale.heading,
    fontVariant: ["tabular-nums"],
    fontWeight: typeWeight.semibold,
  },
  notice: {
    color: colors.textMuted,
    ...typeScale.body,
  },
  resultCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderColor: colors.amber,
    borderRadius: radii.medium,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.sm,
  },
  resultHeadline: {
    color: colors.text,
    ...typeScale.heading,
    fontVariant: ["tabular-nums"],
    fontWeight: typeWeight.semibold,
  },
  section: {
    borderTopColor: colors.borderSoft,
    borderTopWidth: 1,
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
  },
  smallButton: {
    borderColor: colors.border,
    borderRadius: radii.medium,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.sm,
  },
  smallButtonPressed: { opacity: 0.72 },
  smallButtonText: {
    color: colors.text,
    ...typeScale.label,
  },
  sparkline: {
    height: layoutSize.row,
    overflow: "hidden",
  },
  stageLabel: {
    color: colors.textMuted,
    flex: 1,
    ...typeScale.label,
  },
  stageRow: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  stageValue: {
    color: colors.text,
    ...typeScale.label,
    fontVariant: ["tabular-nums"],
  },
  subtitle: {
    color: colors.textMuted,
    marginTop: spacing.optical,
    ...typeScale.label,
  },
  title: {
    color: colors.text,
    ...typeScale.title,
  },
  toggleCopy: {
    flex: 1,
    minWidth: 0,
  },
  toggleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: layoutSize.row,
  },
});
