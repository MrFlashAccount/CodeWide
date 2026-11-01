import { StyleSheet } from "react-native";

import { colors, controlSize, radii, spacing, typeScale } from "../../../theme";

export const tokenSheetStyles = StyleSheet.create({
  body: {
    ...typeScale.body,
    color: colors.textMuted,
  },
  content: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  error: {
    ...typeScale.body,
    color: colors.error,
  },
  input: {
    ...typeScale.body,
    backgroundColor: colors.surfaceContainerHighest,
    borderColor: colors.border,
    borderRadius: radii.small,
    borderWidth: 1,
    color: colors.text,
    minHeight: controlSize.touch,
    paddingHorizontal: spacing.sm,
  },
  // Provider pages sit left-aligned in the sheet's column, wrapping on narrow phones.
  links: {
    alignItems: "flex-start",
    columnGap: spacing.xs,
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: spacing.xs,
  },
  scope: {
    ...typeScale.code,
    backgroundColor: colors.surfaceContainerHighest,
    color: colors.text,
  },
  title: {
    ...typeScale.heading,
    color: colors.text,
  },
});
