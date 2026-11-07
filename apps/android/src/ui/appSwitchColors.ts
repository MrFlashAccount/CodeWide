import { colors } from "../theme";

/**
 * Switch colors in the neutral theme palette (N-03): an on switch is a light
 * track with a dark thumb, an off switch a dark track with a muted thumb.
 */
export const appSwitchColors = {
  offThumb: colors.textMuted,
  onThumb: colors.onPrimary,
  track: { false: colors.surfaceContainerHighest, true: colors.primary },
} as const;
