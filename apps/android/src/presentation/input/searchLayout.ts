import { colors, controlSize, radii, spacing } from "../../theme";

/** Search fields share geometry; result navigation and voice actions remain caller-owned. */
export const searchFieldLayout = {
  alignItems: "center",
  backgroundColor: colors.surfaceContainer,
  borderRadius: radii.medium,
  flexDirection: "row",
  gap: spacing.xxs,
  minHeight: controlSize.regular,
  paddingLeft: spacing.sm,
  paddingRight: spacing.optical,
} as const;
