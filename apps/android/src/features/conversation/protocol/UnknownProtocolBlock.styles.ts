import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../../../theme";

export const styles = StyleSheet.create({
  bubbleNestedSurface: { backgroundColor: "transparent" },
  disabled: { opacity: 0.42 },
  errorText: {
    color: colors.red,
    ...typeScale.body,
  },
  flex: { flex: 1 },
  unknownCard: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.medium,
    flexDirection: "row",
    gap: spacing.compact,
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.xs,
  },
  unknownFixButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radii.medium,
    flexDirection: "row",
    gap: spacing.xxs,
    justifyContent: "center",
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.xs,
  },
  unknownFixText: {
    color: colors.onPrimary,
    ...typeScale.caption,
    fontWeight: typeWeight.semibold,
  },
  unknownText: {
    color: colors.textMuted,
    flex: 1,
    ...typeScale.label,
  },
});
