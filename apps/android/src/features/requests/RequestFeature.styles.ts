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
  answerOptions: { gap: spacing.xxs },
  approvalActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.compact,
    justifyContent: "flex-end",
  },
  approvalButton: {
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.sm,
  },
  approvalCard: {
    backgroundColor: colors.warningContainer,
    borderRadius: radii.medium,
    gap: spacing.xxs,
    marginHorizontal: spacing.xs,
    marginTop: spacing.xxs,
    padding: spacing.xs,
  },
  approvalCommand: {
    backgroundColor: colors.code,
    borderRadius: radii.small,
    color: colors.text,
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
  approvalDeclineButton: {
    alignItems: "center",
    borderRadius: radii.medium,
    justifyContent: "center",
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.inputInset,
  },
  approvalDeclineText: {
    color: colors.textMuted,
    fontWeight: typeWeight.semibold,
  },
  approvalInline: {
    backgroundColor: colors.warningContainer,
    marginHorizontal: 0,
    marginTop: spacing.optical,
  },
  approvalInput: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.small,
    borderWidth: 1,
    color: colors.text,
    minHeight: controlSize.touch,
    paddingHorizontal: spacing.xs,
    ...typeScale.label,
  },
  approvalPending: {
    color: colors.amber,
    ...typeScale.caption,
    fontWeight: typeWeight.semibold,
  },
  approvalQuestion: { gap: spacing.xxs },
  approvalQueueCount: {
    color: colors.textMuted,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  approvalReason: {
    color: colors.textMuted,
    ...typeScale.label,
  },
  approvalTitle: {
    color: colors.text,
    ...typeScale.body,
    flex: 1,
    fontWeight: typeWeight.semibold,
  },
  approvalTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.compact,
  },
  errorText: {
    color: colors.red,
    ...typeScale.body,
  },
  menuActionSubtitle: {
    color: colors.textMuted,
    ...typeScale.label,
    marginTop: spacing.optical,
  },
  menuActionTitle: {
    color: colors.text,
    ...typeScale.title,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radii.medium,
    justifyContent: "center",
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
  },
  primaryButtonText: {
    color: colors.onPrimary,
    fontWeight: typeWeight.semibold,
  },
  rawLink: {
    color: colors.accent,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  secondaryButton: {
    alignItems: "center",
    borderColor: colors.outline,
    borderRadius: radii.medium,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
  },
  secondaryButtonText: {
    color: colors.text,
    fontWeight: typeWeight.semibold,
  },
});
