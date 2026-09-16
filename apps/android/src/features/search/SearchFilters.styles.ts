import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, typeScale } from "../../theme";

export const styles = StyleSheet.create({
  clearDate: {
    alignItems: "center",
    height: controlSize.regular,
    justifyContent: "center",
    width: controlSize.regular,
  },
  dateButton: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: controlSize.regular,
    padding: spacing.sm,
  },
  dateRow: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.small,
    flexDirection: "row",
  },
  divider: {
    backgroundColor: colors.border,
    height: StyleSheet.hairlineWidth,
    marginVertical: spacing.xs,
  },
  group: { gap: spacing.xs },
  heading: {
    ...typeScale.body,
    color: colors.text,
  },
  hint: {
    ...typeScale.label,
    color: colors.textDim,
  },
  label: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  options: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.small,
    maxHeight: controlSize.regular * 5,
  },
  panel: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  scroll: { flexShrink: 1 },
  select: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.small,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: controlSize.regular,
    padding: spacing.sm,
  },
  selected: {
    flex: 1,
    minWidth: 0,
    ...typeScale.body,
    color: colors.text,
  },
});
