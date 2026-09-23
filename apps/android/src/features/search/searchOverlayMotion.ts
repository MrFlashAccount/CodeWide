import { useEffect, useRef } from "react";
import { Keyboard } from "react-native";
import {
  cancelAnimation,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { useEvent } from "../../react/useEvent";
import { useReducedMotionPreference } from "../../rendering/reduced-motion-store";

const SEARCH_OVERLAY_DURATION_MS = 350;

/** Search appears over the retained catalog and closes before its route is dismissed. */
export function useSearchOverlayMotion(onClose: () => void): {
  readonly close: () => void;
  readonly progress: SharedValue<number>;
} {
  const appReducedMotion = useReducedMotionPreference();
  const nativeReducedMotion = useReducedMotion();
  const reducedMotion = appReducedMotion || nativeReducedMotion;
  const progress = useSharedValue(reducedMotion ? 1 : 0);
  const closing = useRef(false);
  const finishClose = useEvent(onClose);
  useEffect(() => {
    if (!reducedMotion) {
      progress.set(withTiming(1, { duration: SEARCH_OVERLAY_DURATION_MS }));
    }
    return () => {
      cancelAnimation(progress);
    };
  }, [progress, reducedMotion]);
  const close = useEvent((): void => {
    if (closing.current) {
      return;
    }
    closing.current = true;
    Keyboard.dismiss();
    if (reducedMotion) {
      finishClose();
      return;
    }
    progress.set(
      withTiming(0, { duration: SEARCH_OVERLAY_DURATION_MS }, (finished) => {
        if (finished === true) {
          scheduleOnRN(finishClose);
        }
      }),
    );
  });
  return { close, progress };
}
