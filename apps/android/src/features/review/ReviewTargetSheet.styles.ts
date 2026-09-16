import { StyleSheet } from "react-native";
import { colors, radii, spacing, touchTarget, typeScale, typeWeight } from "../../theme";

export const styles = StyleSheet.create({
  controlSectionLabel: {
    color: colors.textMuted,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
    paddingBottom: spacing.xs,
    paddingTop: spacing.md,
    textTransform: "uppercase",
  },
  disabled: { opacity: 0.42 },
  errorText: {
    color: colors.red,
    ...typeScale.body,
  },
  fieldInput: {
    backgroundColor: colors.surfaceContainerLow,
    borderColor: colors.outline,
    borderRadius: radii.medium,
    borderWidth: 1,
    color: colors.text,
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
    ...typeScale.body,
  },
  flex: { flex: 1 },
  menuScroll: {
    flex: 1,
    minHeight: 0,
  },
  menuScrollContent: { paddingBottom: spacing.sm },
  menuTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.compact,
    marginBottom: spacing.xs,
    minHeight: touchTarget,
  },
  modeSelector: {
    minHeight: touchTarget,
    width: "100%",
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
  sheetTitle: {
    color: colors.text,
    flexShrink: 1,
    minWidth: 0,
    ...typeScale.heading,
  },
  successText: {
    color: colors.green,
    ...typeScale.label,
  },
});
