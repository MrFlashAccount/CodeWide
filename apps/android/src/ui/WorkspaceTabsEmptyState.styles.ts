import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, typeScale } from "../theme";

export const styles = StyleSheet.create({
  create: {
    alignItems: "center",
    backgroundColor: colors.accent,
    borderRadius: radii.medium,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: controlSize.touch,
    paddingHorizontal: spacing.md,
  },
  createLabel: {
    color: colors.onPrimary,
    ...typeScale.body,
  },
  pressed: { backgroundColor: colors.accentPressed },
  root: {
    alignItems: "center",
    flex: 1,
    gap: spacing.sm,
    justifyContent: "center",
    padding: spacing.lg,
  },
  title: {
    color: colors.textMuted,
    ...typeScale.body,
  },
});
