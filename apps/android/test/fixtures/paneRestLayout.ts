import {
  SIDEBAR_FRAME_SHARE,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "../../src/routeComposition/paneGeometry";

/**
 * The catalog's settled sidebar box: relative to the pane frame and bounded, so Yoga resolves it
 * from the frame's actual width instead of a JavaScript measurement.
 */
export const RESTING_SIDEBAR = {
  maxWidth: SIDEBAR_MAX_WIDTH,
  minWidth: SIDEBAR_MIN_WIDTH,
  width: SIDEBAR_FRAME_SHARE,
} as const;
