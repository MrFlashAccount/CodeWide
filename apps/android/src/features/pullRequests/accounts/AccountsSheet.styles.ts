import { StyleSheet } from "react-native";

import { colors, iconSize, radii, spacing, typeScale } from "../../../theme";

/** Shared row and server-heading alignment in pull request account settings. */
export const accountsSheetStyles = StyleSheet.create({
  content: {
    gap: spacing.md,
    paddingBottom: spacing.md,
  },
  identity: {
    ...typeScale.label,
    color: colors.textMuted,
    paddingHorizontal: spacing.md,
  },
  leadingSlot: {
    alignItems: "center",
    flexShrink: 0,
    justifyContent: "center",
    width: iconSize.action,
  },
  rowError: {
    ...typeScale.label,
    color: colors.error,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  serverHeading: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    minHeight: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  serverName: {
    ...typeScale.title,
    color: colors.text,
    flexShrink: 1,
  },
  serverSection: { gap: spacing.xs },
  statusDot: {
    borderRadius: radii.pill,
    height: spacing.compact,
    width: spacing.compact,
  },
});
