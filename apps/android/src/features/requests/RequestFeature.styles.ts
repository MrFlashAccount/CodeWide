import { Platform, StyleSheet } from "react-native";
import {
  colors,
  controlSize,
  radii,
  spacing,
  touchTarget,
  typeScale,
  typeWeight,
} from "../../theme";

export const styles = StyleSheet.create({
  rawLink: {
    color: colors.accent,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  menuActionTitle: {
    color: colors.text,
    ...typeScale.title,
  },
  menuActionSubtitle: {
    color: colors.textMuted,
    ...typeScale.label,
    marginTop: spacing.optical,
  },
  approvalCard: {
    marginHorizontal: spacing.xs,
    marginTop: spacing.xxs,
    padding: spacing.xs,
    gap: spacing.xxs,
    borderRadius: radii.medium,
    backgroundColor: colors.warningContainer,
  },
  approvalInline: {
    marginHorizontal: 0,
    marginTop: spacing.optical,
    backgroundColor: colors.warningContainer,
  },
  approvalTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.compact,
  },
  approvalTitle: {
    color: colors.text,
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
    flex: 1,
  },
  approvalPending: {
    color: colors.amber,
    ...typeScale.caption,
    fontWeight: typeWeight.semibold,
  },
  approvalQueueCount: {
    color: colors.textMuted,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  approvalReason: {
    color: colors.textMuted,
    ...typeScale.label,
  },
  approvalCommand: {
    color: colors.text,
    backgroundColor: colors.code,
    borderRadius: radii.small,
    padding: spacing.compact,
    ...typeScale.code,
    fontFamily: Platform.select({
      android: "monospace",
      default: "Courier",
    }),
  },
  approvalCwd: {
    color: colors.textDim,
    ...typeScale.label,
  },
  approvalQuestion: { gap: spacing.xxs },
  approvalInput: {
    minHeight: controlSize.touch,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radii.small,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.xs,
    ...typeScale.label,
  },
  answerOptions: { gap: spacing.xxs },
  approvalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.compact,
    flexWrap: "wrap",
  },
  approvalButton: {
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.sm,
  },
  approvalDeclineButton: {
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.inputInset,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.medium,
  },
  approvalDeclineText: {
    color: colors.textMuted,
    fontWeight: typeWeight.semibold,
  },
  errorText: {
    color: colors.red,
    ...typeScale.body,
  },
  secondaryButton: {
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.medium,
    borderWidth: 1,
    borderColor: colors.outline,
  },
  secondaryButtonText: {
    color: colors.text,
    fontWeight: typeWeight.semibold,
  },
  primaryButton: {
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.medium,
    backgroundColor: colors.primary,
  },
  primaryButtonText: {
    color: colors.onPrimary,
    fontWeight: typeWeight.semibold,
  },
});
