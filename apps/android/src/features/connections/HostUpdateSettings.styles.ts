import { StyleSheet } from "react-native";

import { colors, radii, spacing, typeScale, typeWeight } from "../../theme";

export const styles = StyleSheet.create({
  actions: {
    gap: spacing.xs,
  },
  body: {
    backgroundColor: colors.surfaceContainerLow,
    borderRadius: radii.medium,
    gap: spacing.sm,
    padding: spacing.md,
  },
  detail: {
    color: colors.textMuted,
    ...typeScale.body,
  },
  error: {
    color: colors.red,
    ...typeScale.body,
  },
  label: {
    color: colors.textMuted,
    ...typeScale.label,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    minWidth: 0,
  },
  status: {
    color: colors.textMuted,
    ...typeScale.body,
  },
  success: {
    color: colors.green,
    ...typeScale.body,
  },
  value: {
    color: colors.text,
    flexShrink: 1,
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
  },
  versionShimmer: {
    alignItems: "flex-end",
    flex: 1,
  },
});
