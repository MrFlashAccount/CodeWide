import { withSpring } from "react-native-reanimated";

/**
 * One spatial spring moves every pane. Each rearrangement springs a single progress from 0 to 1
 * and every pane property derives from it, so panes that open, close, slide or resize together
 * stay in step and settle together. Critically damped enough to read as a firm, quiet stop with
 * no visible bounce; long enough for the eye to follow a pane across a tablet-width screen. The
 * spring keeps Reanimated's default `ReduceMotion.System`, so the system setting stills it.
 */
export const PANE_SPRING_DURATION_MS = 460;
const PANE_SPRING_DAMPING_RATIO = 0.92;
/** How far a covered catalog dims under the destination that slides over it. */
export const COVERED_CATALOG_OPACITY = 0;

const PANE_SPRING = {
  dampingRatio: PANE_SPRING_DAMPING_RATIO,
  duration: PANE_SPRING_DURATION_MS,
} as const;

/** Springs a rearrangement's progress to its settled end, `1`. */
export function paneSpring(onFinished: (finished?: boolean) => void): number {
  "worklet";
  return withSpring(1, PANE_SPRING, onFinished);
}
