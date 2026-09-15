import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../../../theme";

export const styles = StyleSheet.create({
  flex: { flex: 1 },
  bubbleNestedSurface: { backgroundColor: "transparent" },
  unknownCard: {
    minHeight: controlSize.regular,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.compact,
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.medium,
    paddingHorizontal: spacing.xs,
  },
  unknownText: {
    flex: 1,
    color: colors.textMuted,
    ...typeScale.label,
  },
  unknownFixButton: {
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.xs,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xxs,
    borderRadius: radii.medium,
    backgroundColor: colors.primary,
  },
  unknownFixText: {
    color: colors.onPrimary,
    ...typeScale.caption,
    fontWeight: typeWeight.semibold,
  },
  disabled: { opacity: 0.42 },
  errorText: {
    color: colors.red,
    ...typeScale.body,
  },
});
