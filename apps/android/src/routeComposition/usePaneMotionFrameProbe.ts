import { useContext, useEffect, useRef } from "react";
import { useFrameCallback, useSharedValue, type SharedValue } from "react-native-reanimated";

import { operationalDiagnosticsEnabled, recordDiagnosticTiming } from "../data/operational-metrics";
import { useEvent } from "../react/useEvent";
import { PaneMotionContext } from "./paneMotion";

/** Frames kept per rearrangement: a 460 ms spring at 120 Hz takes about 56. */
const MAX_FRAMES = 128;

/**
 * Measures UI-thread frame intervals while this frame's panes move, as on-device evidence of
 * rearrangement smoothness (`pane_motion_frame_ms` in Data for geeks). Inert unless Data for
 * geeks is on when a rearrangement arms: the frame callback stays registered but inactive, and
 * the samples cross to JavaScript once, when the rearrangement settles.
 */
export function usePaneMotionFrameProbe(moving: SharedValue<boolean>): void {
  const motion = useContext(PaneMotionContext);
  const intervals = useSharedValue<number[]>([]);
  const frames = useFrameCallback((frame) => {
    const interval = frame.timeSincePreviousFrame;
    if (interval === null || !moving.get()) {
      return;
    }
    intervals.modify((list) => {
      "worklet";
      if (list.length < MAX_FRAMES) {
        list.push(interval);
      }
      return list;
    }, false);
  }, false);
  const active = useRef(false);
  const onArmed = useEvent((armed: boolean): void => {
    if (armed && !active.current && operationalDiagnosticsEnabled()) {
      intervals.set([]);
      active.current = true;
      frames.setActive(true);
      return;
    }
    if (!armed && active.current) {
      active.current = false;
      frames.setActive(false);
      for (const interval of intervals.get()) {
        recordDiagnosticTiming("pane_motion_frame_ms", interval);
      }
      intervals.set([]);
    }
  });
  // WHY: the armed window is an external observable; the subscription only follows it.
  useEffect(
    () =>
      motion.armed$.onChange(({ value }) => {
        onArmed(value);
      }),
    [motion, onArmed],
  );
}
