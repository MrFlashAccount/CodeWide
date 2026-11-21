import { PixelRatio } from "react-native";

interface Size {
  readonly height: number;
  readonly width: number;
}

/** The deepest zoom of a fullscreen Pele diagram. */
export const PELE_DIAGRAM_MAX_ZOOM = 5;

/** The longest bitmap side drawn for a diagram; within every GPU texture limit. */
const MAX_BITMAP_SIDE_PX = 4096;

/**
 * How many times larger than its fitted size the diagram is drawn: up to the
 * maximum zoom, while the bitmap's long side stays within a GPU texture.
 */
export function supersampling(fit: Size, pixelRatio = PixelRatio.get()): number {
  const longSidePixels = Math.max(fit.width, fit.height) * pixelRatio;
  if (longSidePixels <= 0) {
    return 1;
  }
  return Math.max(1, Math.min(PELE_DIAGRAM_MAX_ZOOM, MAX_BITMAP_SIDE_PX / longSidePixels));
}
