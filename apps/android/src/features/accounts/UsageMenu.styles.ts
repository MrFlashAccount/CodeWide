import { StyleSheet } from "react-native";

import {
  colors,
  controlSize,
  iconSize,
  layoutSize,
  spacing,
  touchTarget,
  typeScale,
  typeWeight,
} from "../../theme";

const DISABLED_OPACITY = 0.4;
const PRESSED_OPACITY = 0.7;

export const styles = StyleSheet.create({
  accountValue: {
    color: colors.text,
    flexShrink: 0,
    ...typeScale.body,
    fontVariant: ["tabular-nums"],
  },
  action: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: touchTarget,
    paddingHorizontal: spacing.sm,
  },
  actionIcon: {
    alignItems: "center",
    flexShrink: 0,
    height: iconSize.action,
    justifyContent: "center",
    width: iconSize.action,
  },
  actionTitle: {
    color: colors.text,
    ...typeScale.body,
  },
  content: { paddingVertical: spacing.xxs },
  contextRingLabel: {
    alignItems: "center",
    inset: 0,
    justifyContent: "center",
    position: "absolute",
  },
  contextRingLabelText: {
    color: colors.text,
    fontWeight: typeWeight.semibold,
    includeFontPadding: false,
    textAlign: "center",
    width: "100%",
  },
  contextRingNumber: {
    alignItems: "center",
    width: "100%",
  },
  contextSummary: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: layoutSize.header,
  },
  disabled: { opacity: DISABLED_OPACITY },
  dividedAction: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  dividedSection: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  error: {
    color: colors.red,
    ...typeScale.label,
  },
  grow: {
    flex: 1,
    minWidth: 0,
  },
  meta: {
    color: colors.textDim,
    ...typeScale.label,
  },
  pressed: { opacity: PRESSED_OPACITY },
  primaryValue: {
    color: colors.text,
    ...typeScale.heading,
    fontVariant: ["tabular-nums"],
    fontWeight: typeWeight.semibold,
  },
  resetRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: layoutSize.metadataRow,
  },
  secondaryValue: {
    color: colors.textMuted,
    ...typeScale.body,
    fontVariant: ["tabular-nums"],
  },
  section: {
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  sessionCostText: {
    color: colors.textMuted,
    flexShrink: 0,
    ...typeScale.label,
    fontVariant: ["tabular-nums"],
  },
  sessionSummaryRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: controlSize.regular,
  },
  sessionSummarySeparator: {
    color: colors.textMuted,
    flexShrink: 0,
    ...typeScale.label,
  },
  sessionSummaryText: {
    color: colors.textMuted,
    flexShrink: 1,
    minWidth: 0,
    textAlign: "right",
    ...typeScale.label,
    fontVariant: ["tabular-nums"],
  },
  sessionSummaryValues: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.xxs,
    justifyContent: "flex-end",
    minWidth: 0,
  },
  title: {
    color: colors.textMuted,
    ...typeScale.label,
  },
  unavailable: { color: colors.textMuted },
  weeklyHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "space-between",
    minHeight: controlSize.compact,
  },
  weeklyTitle: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  weeklyValue: {
    color: colors.text,
    flexShrink: 1,
    ...typeScale.title,
    fontVariant: ["tabular-nums"],
    fontWeight: typeWeight.semibold,
  },
});
