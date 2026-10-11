import { Platform, StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../../theme";

const APPROVAL_ACTION_MIN_WIDTH = controlSize.touch + controlSize.touch;

export const styles = StyleSheet.create({
  answerOptions: { gap: spacing.xxs },
  approvalAction: {
    alignItems: "center",
    borderRadius: radii.small,
    borderWidth: 1,
    flexBasis: APPROVAL_ACTION_MIN_WIDTH,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.xs,
  },
  approvalActionPrimary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  approvalActionPrimaryText: { color: colors.onPrimary },
  approvalActionQuiet: {
    backgroundColor: "transparent",
    borderColor: "transparent",
  },
  approvalActionQuietText: { color: colors.textMuted },
  approvalActions: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    justifyContent: "flex-end",
    marginTop: spacing.xxs,
  },
  approvalActionSecondary: {
    backgroundColor: "transparent",
    borderColor: colors.outline,
  },
  approvalActionSecondaryText: { color: colors.text },
  approvalActionText: {
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
    includeFontPadding: false,
    textAlign: "center",
  },
  approvalCard: {
    backgroundColor: colors.surfaceContainerLow,
    borderColor: colors.border,
    borderRadius: radii.medium,
    borderWidth: 1,
    gap: spacing.xs,
    marginHorizontal: spacing.xs,
    marginTop: spacing.xxs,
    padding: spacing.sm,
  },
  approvalCommand: {
    backgroundColor: colors.code,
    borderColor: colors.borderSoft,
    borderRadius: radii.small,
    borderWidth: 1,
    color: colors.text,
    paddingHorizontal: spacing.inputInset,
    paddingVertical: spacing.xs,
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
  approvalIcon: {
    backgroundColor: colors.warningContainer,
    borderRadius: radii.small,
    height: controlSize.compact,
    lineHeight: controlSize.compact,
    textAlign: "center",
    width: controlSize.compact,
  },
  approvalInline: {
    backgroundColor: "transparent",
    borderBottomWidth: 0,
    borderColor: colors.borderSoft,
    borderLeftWidth: 0,
    borderRadius: 0,
    borderRightWidth: 0,
    borderTopWidth: 1,
    marginHorizontal: 0,
    marginTop: spacing.sm,
    paddingBottom: 0,
    paddingHorizontal: 0,
    paddingTop: spacing.sm,
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
  approvalMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.compact,
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
    fontWeight: typeWeight.semibold,
  },
  approvalTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.compact,
  },
  approvalTitleSlot: {
    flex: 1,
    minWidth: 0,
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
  rawLink: {
    color: colors.accent,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
});
