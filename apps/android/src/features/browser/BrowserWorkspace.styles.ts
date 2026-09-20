import { StyleSheet } from "react-native";
import { colors, spacing, typeScale } from "../../theme";

export const styles = StyleSheet.create({
  flex: { flex: 1 },
  previewError: {
    backgroundColor: colors.errorContainer,
    color: colors.red,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    ...typeScale.label,
  },
  root: {
    backgroundColor: colors.background,
    flex: 1,
  },
});
