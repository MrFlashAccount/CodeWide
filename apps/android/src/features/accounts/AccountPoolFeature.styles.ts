import { Platform, StyleSheet } from "react-native";
import {
  colors,
  controlSize,
  radii,
  spacing,
  touchTarget,
  typeScale,
  typeTracking,
  typeWeight,
} from "../../theme";

export const styles = StyleSheet.create({
  accountLoginCode: {
    color: colors.text,
    ...typeScale.heading,
    fontFamily: Platform.select({
      android: "monospace",
      default: "Courier",
    }),
    letterSpacing: typeTracking.pairingCode,
  },
  accountLoginCodeCard: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.large,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 92,
    padding: spacing.md,
  },
  accountLoginCodeLabel: {
    color: colors.textMuted,
    ...typeScale.label,
  },
  accountLoginCopyButton: {
    alignItems: "center",
    borderColor: colors.outline,
    borderRadius: radii.medium,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xxs,
    justifyContent: "center",
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.sm,
  },
  accountLoginCopyButtonDone: {
    backgroundColor: colors.successContainer,
    borderColor: colors.green,
  },
  accountLoginCopyLabel: {
    color: colors.text,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  accountLoginCopyLabelDone: { color: colors.green },
  accountLoginHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: touchTarget,
  },
  accountLoginHint: {
    color: colors.textMuted,
    ...typeScale.body,
  },
  accountLoginIcon: {
    alignItems: "center",
    backgroundColor: colors.primaryContainer,
    borderRadius: radii.large,
    height: controlSize.regular,
    justifyContent: "center",
    width: controlSize.regular,
  },
  accountLoginPrimaryButton: {
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: controlSize.regular,
  },
  accountLoginSheet: {
    gap: spacing.md,
    paddingBottom: spacing.xs,
  },
  accountLoginSubtitle: {
    color: colors.textMuted,
    ...typeScale.body,
    marginTop: spacing.optical,
  },
  accountLoginTitle: {
    color: colors.text,
    ...typeScale.heading,
  },
  accountPoolAddButton: {
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: spacing.xs,
    minHeight: controlSize.regular,
  },
  accountPoolEditor: {
    gap: 0,
    marginTop: spacing.md,
  },
  accountPoolHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    marginBottom: spacing.xs,
    minHeight: controlSize.touch,
  },
  accountPoolLimit: {
    color: colors.text,
    flexShrink: 0,
    ...typeScale.label,
    fontVariant: ["tabular-nums"],
    fontWeight: typeWeight.semibold,
  },
  accountPoolLimitPending: {
    color: colors.textDim,
    fontWeight: typeWeight.semibold,
  },
  accountPoolMenuAnchor: {
    flexShrink: 0,
    height: touchTarget,
    width: touchTarget,
  },
  connectionMiniButton: {
    alignItems: "center",
    borderRadius: radii.medium,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  connectionStateDot: {
    borderRadius: radii.pill,
    height: 7,
    width: 7,
  },
  disabled: { opacity: 0.42 },
  errorText: {
    color: colors.red,
    ...typeScale.body,
  },
  fieldLabel: {
    color: colors.textMuted,
    ...typeScale.label,
    marginTop: spacing.xxs,
  },
  flex: { flex: 1 },
  menuActionSubtitle: {
    color: colors.textMuted,
    ...typeScale.label,
    marginTop: spacing.optical,
  },
  menuNotice: {
    color: colors.textMuted,
    ...typeScale.body,
    paddingVertical: spacing.xs,
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
