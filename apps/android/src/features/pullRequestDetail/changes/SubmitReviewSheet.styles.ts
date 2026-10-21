import { StyleSheet } from "react-native";

import { colors, controlSize, radii, spacing, typeScale, typeWeight } from "../../../theme";

export const submitSheetStyles = StyleSheet.create({
  content: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  danger: {
    ...typeScale.label,
    color: colors.error,
  },
  dangerLabel: {
    color: colors.error,
  },
  input: {
    ...typeScale.body,
    backgroundColor: colors.surfaceContainerHighest,
    borderRadius: radii.small,
    color: colors.text,
    minHeight: controlSize.touch,
    padding: spacing.sm,
  },
  label: {
    ...typeScale.body,
    color: colors.text,
  },
  line: {
    alignItems: "center",
    borderTopColor: colors.borderSoft,
    borderTopWidth: StyleSheet.hairlineWidth,
    columnGap: spacing.sm,
    flexDirection: "row",
    minHeight: controlSize.touch,
    paddingTop: spacing.xs,
  },
  lineBody: {
    flex: 1,
    minWidth: 0,
  },
  meta: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  submitLabel: {
    ...typeScale.body,
    color: colors.text,
    fontWeight: typeWeight.medium,
  },
  title: {
    ...typeScale.heading,
    color: colors.text,
  },
});
