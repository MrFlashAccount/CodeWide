import { StyleSheet } from "react-native";
import { colors, radii, spacing, typeScale, touchTarget } from "../../theme";

export const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    borderRadius: radii.small,
    justifyContent: "center",
    minHeight: touchTarget,
    minWidth: touchTarget,
    paddingHorizontal: spacing.xs,
  },
  controls: {
    alignItems: "center",
    gap: spacing.xxs,
    paddingHorizontal: spacing.xxs,
  },
  hint: {
    ...typeScale.caption,
    color: colors.textMuted,
    paddingHorizontal: spacing.xs,
  },
  label: {
    ...typeScale.body,
    color: colors.text,
  },
  root: { flex: 1 },
  row: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexGrow: 0,
  },
  selected: { backgroundColor: colors.accentMuted },
});
