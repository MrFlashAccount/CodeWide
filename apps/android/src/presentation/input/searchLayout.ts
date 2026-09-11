import { colors, controlSize, radii, spacing } from "../../theme";

/** Search fields share geometry; result navigation and voice actions remain caller-owned. */
export const searchFieldLayout = {
  minHeight: controlSize.regular,
  borderRadius: radii.medium,
  backgroundColor: colors.surfaceContainer,
  flexDirection: "row",
  alignItems: "center",
  paddingLeft: spacing.sm,
  paddingRight: spacing.optical,
  gap: spacing.xxs,
} as const;
