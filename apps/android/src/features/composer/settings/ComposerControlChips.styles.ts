import { StyleSheet } from "react-native";
import { colors, controlSize, radii, spacing } from "../../../theme";

export const styles = StyleSheet.create({
  composerContextChip: {
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
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xxs,
  },
});
