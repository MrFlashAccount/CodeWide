import { StyleSheet } from "react-native";

import { colors, spacing, typeScale } from "../../theme";

export const styles = StyleSheet.create({
  list: { paddingBottom: spacing.sm },
  notice: {
    color: colors.textMuted,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.sm,
    ...typeScale.body,
  },
  title: {
    color: colors.text,
    ...typeScale.title,
  },
  titleRow: {
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
});
