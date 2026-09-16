import { StyleSheet } from "react-native";
import { colors, spacing, typeScale } from "../../theme";

export const styles = StyleSheet.create({
  threadListEmpty: {
    alignItems: "center",
    gap: spacing.xs,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl + spacing.md,
  },
  threadListEmptyText: {
    color: colors.textMuted,
    ...typeScale.body,
  },
});
