import { StyleSheet } from "react-native";
import { colors, radii, spacing, typeScale } from "../../theme";

export const styles = StyleSheet.create({
  action: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  actionText: {
    color: colors.accent,
    ...typeScale.label,
  },
  failure: {
    alignItems: "center",
    backgroundColor: colors.background,
    inset: 0,
    justifyContent: "center",
    padding: spacing.lg,
    position: "absolute",
  },
  message: {
    color: colors.textMuted,
    ...typeScale.body,
  },
  notice: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radii.small,
    bottom: spacing.sm,
    flexDirection: "row",
    left: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    position: "absolute",
    right: spacing.sm,
  },
});
