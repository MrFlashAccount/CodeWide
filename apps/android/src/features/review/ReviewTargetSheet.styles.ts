import { StyleSheet } from "react-native";
import { colors, radii, spacing, touchTarget, typeScale, typeWeight } from "../../theme";

export const styles = StyleSheet.create({
  flex: { flex: 1 },
  sheetTitle: {
    minWidth: 0,
    flexShrink: 1,
    color: colors.text,
    ...typeScale.heading,
  },
  menuTitleRow: {
    minHeight: touchTarget,
    marginBottom: spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.compact,
  },
  menuScroll: {
    flex: 1,
    minHeight: 0,
  },
  menuScrollContent: { paddingBottom: spacing.sm },
  controlSectionLabel: {
    color: colors.textMuted,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
    textTransform: "uppercase",
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  disabled: { opacity: 0.42 },
  modeSelector: {
    width: "100%",
    minHeight: touchTarget,
  },
  successText: {
    color: colors.green,
    ...typeScale.label,
  },
  fieldInput: {
    minHeight: touchTarget,
    color: colors.text,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.medium,
    borderWidth: 1,
    borderColor: colors.outline,
    paddingHorizontal: spacing.md,
    ...typeScale.body,
  },
  errorText: {
    color: colors.red,
    ...typeScale.body,
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
