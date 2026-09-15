/** Finger travel arms the action; visual travel stays short even on a wide composer. */
export const COMPOSER_SWIPE_THRESHOLD = 56;
export const COMPOSER_SWIPE_TARGET = 36;
const ELASTIC_TRAVEL = 20;

export type ComposerSwipeDirection = "none" | "discard" | "steer";

/** Lock intent when the pan activates so a diagonal drag cannot switch actions midway. */
export function composerSwipeDirection(x: number, y: number): ComposerSwipeDirection {
  "worklet";
  if (Math.abs(x) >= Math.abs(y)) return x < 0 ? "discard" : "none";
  return y < 0 ? "steer" : "none";
}

export function composerSwipeTravel(distance: number): number {
  "worklet";
  const positive = Math.max(0, distance);
  if (positive <= COMPOSER_SWIPE_THRESHOLD)
    return (positive * COMPOSER_SWIPE_TARGET) / COMPOSER_SWIPE_THRESHOLD;
  const excess = positive - COMPOSER_SWIPE_THRESHOLD;
  return COMPOSER_SWIPE_TARGET + (ELASTIC_TRAVEL * excess) / (excess + COMPOSER_SWIPE_THRESHOLD);
}

/** Returning below the threshold disarms the action before release. */
export function composerSwipeArmed(distance: number): boolean {
  "worklet";
  return distance >= COMPOSER_SWIPE_THRESHOLD;
}
