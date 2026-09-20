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

const RESET_METER_WIDTH = 112;
const RESET_PROGRESS_HEIGHT = 5;

export const styles = StyleSheet.create({
  accountBankedReset: {
    alignItems: "center",
    borderRadius: radii.small,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: touchTarget,
  },
  accountBankedResetPressed: {
    backgroundColor: colors.surfaceContainerHigh,
  },
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
  accountPoolMenuAnchor: {
    flexShrink: 0,
    height: touchTarget,
    width: touchTarget,
  },
  accountResetDetails: {
    gap: spacing.xs,
  },
  accountResetDetailsSeparator: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  accountResetDetailsSurface: {
    backgroundColor: colors.surfaceContainer,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  accountResetDetailsSurfaceLast: {
    borderBottomLeftRadius: radii.medium,
    borderBottomRightRadius: radii.medium,
  },
  accountResetError: {
    color: colors.red,
    ...typeScale.caption,
  },
  accountResetProgressFill: {
    borderRadius: radii.pill,
    height: "100%",
  },
  accountResetProgressTrack: {
    backgroundColor: colors.surfaceContainerHighest,
    borderRadius: radii.pill,
    height: RESET_PROGRESS_HEIGHT,
    overflow: "hidden",
    width: "100%",
  },
  accountResetSectionTitle: {
    color: colors.text,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
    marginTop: spacing.xxs,
  },
  accountResetStatus: {
    color: colors.textDim,
    ...typeScale.label,
  },
  accountResetUnavailable: {
    color: colors.textDim,
    ...typeScale.label,
  },
  accountResetWindow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: controlSize.regular,
  },
  accountResetWindowCopy: {
    flex: 1,
    gap: spacing.optical,
  },
  accountResetWindowLabel: {
    color: colors.textMuted,
    ...typeScale.label,
  },
  accountResetWindowMeter: {
    alignItems: "flex-end",
    gap: spacing.xxs,
    width: RESET_METER_WIDTH,
  },
  accountResetWindowRemaining: {
    color: colors.text,
    ...typeScale.label,
    fontVariant: ["tabular-nums"],
    fontWeight: typeWeight.semibold,
  },
  accountResetWindowTime: {
    color: colors.textDim,
    ...typeScale.caption,
    fontVariant: ["tabular-nums"],
  },
  connectionMiniButton: {
    alignItems: "center",
    borderRadius: radii.medium,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
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
});
