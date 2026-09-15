import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing } from "../../../theme";

export const styles = StyleSheet.create({
  composerContextChip: {
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: "flex-start",
    minHeight: controlSize.compact,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.compact,
    borderRadius: radii.medium,
    backgroundColor: colors.surfaceContainerHigh,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
