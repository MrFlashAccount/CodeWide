import { spacing } from "../theme";

export const SLIDER_TRACK_INSET = spacing.md + spacing.optical;

const MIN_STOPS = 2;
const CENTER_DIVISOR = 2;

/** Map a point in the fixed gesture surface to an inset, clamped stop. */
export function sliderStopAt(x: number, width: number, count: number): number {
  "worklet";
  if (count < MIN_STOPS || width <= SLIDER_TRACK_INSET * CENTER_DIVISOR) {
    return 0;
  }
  // Keep this gesture worklet self-contained: calling another module worklet
  // resolved to `undefined` in the release UI runtime and crashed on touch.
  const fraction = (x - SLIDER_TRACK_INSET) / (width - SLIDER_TRACK_INSET * CENTER_DIVISOR);
  return Math.round(Math.max(0, Math.min(1, fraction)) * (count - 1));
}

/** Follow the finger between stops without starting a new spring on each update. */
export function sliderProgressAt(x: number, width: number): number {
  "worklet";
  if (width <= SLIDER_TRACK_INSET * CENTER_DIVISOR) {
    return 0;
  }
  const fraction = (x - SLIDER_TRACK_INSET) / (width - SLIDER_TRACK_INSET * CENTER_DIVISOR);
  return Math.max(0, Math.min(1, fraction));
}

export function sliderStopCenter(index: number, width: number, count: number): number {
  "worklet";
  return sliderCenterAtProgress(index / (count - 1), width, count);
}

/** Keep the animated thumb aligned with the inset tick centers. */
export function sliderCenterAtProgress(progress: number, width: number, count: number): number {
  "worklet";
  if (count < MIN_STOPS || width <= SLIDER_TRACK_INSET * CENTER_DIVISOR) {
    return width / CENTER_DIVISOR;
  }
  return (
    SLIDER_TRACK_INSET +
    (width - SLIDER_TRACK_INSET * CENTER_DIVISOR) * Math.max(0, Math.min(1, progress))
  );
}
