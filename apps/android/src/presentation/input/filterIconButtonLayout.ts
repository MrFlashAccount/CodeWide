import { controlSize, radii, spacing } from "../../theme";

/** Shared transparent filter-button geometry and states for list and search filters. */
export const filterIconButtonLayout = {
  alignItems: "center",
  borderRadius: radii.large,
  flexShrink: 0,
  justifyContent: "center",
  minHeight: controlSize.touch,
  position: "relative",
  width: controlSize.touch,
} as const;

export const filterIconButtonPressed = { opacity: 0.68 } as const;

export const filterIconButtonDotLayout = {
  borderRadius: radii.pill,
  height: 6,
  position: "absolute",
  right: spacing.xs,
  top: spacing.xs,
  width: 6,
} as const;
