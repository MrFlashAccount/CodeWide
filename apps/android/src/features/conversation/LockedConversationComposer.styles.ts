import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../../theme";

const DISABLED_OPACITY = 0.48;
const PRESSED_OPACITY = 0.68;

export const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    borderColor: colors.borderSoft,
    borderRadius: radii.medium,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.md,
  },
  actionLabel: {
    ...typeScale.label,
    color: colors.text,
    fontWeight: typeWeight.semibold,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "flex-end",
  },
  description: {
    ...typeScale.body,
    color: colors.textMuted,
  },
  disabled: { opacity: DISABLED_OPACITY },
  error: {
    ...typeScale.label,
    color: colors.red,
  },
  pressed: { opacity: PRESSED_OPACITY },
  primaryAction: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  primaryLabel: { color: colors.onPrimary },
  root: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.borderSoft,
    borderRadius: radii.medium,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    marginBottom: spacing.xs,
    marginHorizontal: spacing.sm,
    padding: spacing.sm,
  },
  title: {
    ...typeScale.body,
    color: colors.text,
    fontWeight: typeWeight.semibold,
  },
});
