import { controlSize, radii, spacing } from "../../theme";

const PRESSED_OPACITY = 0.68;
const FILTER_DOT_SIZE = 6;

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

export const filterIconButtonPressed = { opacity: PRESSED_OPACITY } as const;

export const filterIconButtonDotLayout = {
  borderRadius: radii.pill,
  height: FILTER_DOT_SIZE,
  position: "absolute",
  right: spacing.xs,
  top: spacing.xs,
  width: FILTER_DOT_SIZE,
} as const;
