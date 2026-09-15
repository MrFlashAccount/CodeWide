import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, typeScale } from "../../theme";

export const styles = StyleSheet.create({
  scroll: { flexShrink: 1 },
  panel: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  heading: {
    ...typeScale.body,
    color: colors.text,
  },
  group: { gap: spacing.xs },
  label: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  hint: {
    ...typeScale.label,
    color: colors.textDim,
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.small,
  },
  dateButton: {
    flex: 1,
    minHeight: controlSize.regular,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
  },
  clearDate: {
    width: controlSize.regular,
    height: controlSize.regular,
    alignItems: "center",
    justifyContent: "center",
  },
  select: {
    minHeight: controlSize.regular,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.small,
  },
  selected: {
    flex: 1,
    minWidth: 0,
    ...typeScale.body,
    color: colors.text,
  },
  options: {
    maxHeight: controlSize.regular * 5,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.small,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
});
