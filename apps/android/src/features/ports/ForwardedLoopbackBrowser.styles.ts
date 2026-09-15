import { StyleSheet } from "react-native";
import { colors, spacing, typeScale } from "../../theme";

export const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: { flex: 1 },
  previewError: {
    color: colors.red,
    backgroundColor: colors.errorContainer,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    ...typeScale.label,
  },
});
