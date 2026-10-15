import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../../theme";

const PRESSED_OPACITY = 0.72;

export const styles = StyleSheet.create({
  label: {
    color: colors.text,
    flexShrink: 1,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
  row: {
    alignItems: "center",
    borderRadius: radii.medium,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: controlSize.touch,
  },
  rowName: {
    color: colors.text,
    ...typeScale.body,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  total: {
    color: colors.textMuted,
    flexShrink: 0,
    ...typeScale.label,
  },
  trigger: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.surfaceContainerHigh,
    borderColor: colors.border,
    borderRadius: radii.medium,
    borderWidth: 1,
    flexDirection: "row",
    flexGrow: 0,
    flexShrink: 0,
    gap: spacing.compact,
    minHeight: controlSize.compact,
    paddingLeft: spacing.xxs,
    paddingRight: spacing.xs,
    paddingVertical: spacing.optical,
  },
});
