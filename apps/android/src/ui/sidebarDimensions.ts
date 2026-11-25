/** The catalog sidebar takes this share of the frame width, within the bounds below. */
const SIDEBAR_FRAME_PERCENT = 34;
/** The same share as a Yoga percentage; the type keeps both spellings equal. */
export const SIDEBAR_FRAME_SHARE = "34%" satisfies `${typeof SIDEBAR_FRAME_PERCENT}%`;
/** Minimum width of a catalog beside its destination. */
export const SIDEBAR_MIN_WIDTH = 320;
/** Maximum width of a catalog beside its destination. */
export const SIDEBAR_MAX_WIDTH = 480;
const PERCENT = 100;

/**
 * The catalog sidebar width in a frame `frameWidth` wide: the formula Yoga applies at rest to
 * `width: "34%"` with `minWidth`/`maxWidth`, so a motion's explicit end equals the settled layout.
 */
export function sidebarWidth(frameWidth: number): number {
  "worklet";
  return Math.max(
    SIDEBAR_MIN_WIDTH,
    Math.min(SIDEBAR_MAX_WIDTH, (frameWidth * SIDEBAR_FRAME_PERCENT) / PERCENT),
  );
}
