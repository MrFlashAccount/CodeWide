import { StyleSheet } from "react-native";

import { colors, controlSize, spacing, typeScale } from "../../../theme";

/** Geometry of the Accounts sheet: grouped provider lists in the account-pool rhythm. */
export const accountsSheetStyles = StyleSheet.create({
  addLeading: {
    alignItems: "center",
    height: controlSize.touch,
    justifyContent: "center",
    width: controlSize.touch,
  },
  content: {
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  group: {
    gap: spacing.xxs,
  },
  groupRows: {
    gap: 0,
  },
  rowError: {
    ...typeScale.label,
    color: colors.error,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  rowTrailing: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xxs,
  },
  title: {
    ...typeScale.title,
    color: colors.text,
    paddingHorizontal: spacing.md,
  },
});
