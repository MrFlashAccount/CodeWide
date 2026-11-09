import { useRef, useState } from "react";
import { StyleSheet, type GestureResponderEvent } from "react-native";
import { useSharedValue, withTiming, type SharedValue } from "react-native-reanimated";

import { useEvent } from "../react/useEvent";
import { radii, touchTarget } from "../theme";

const CHROME_FADE_MS = 160;
/** A touch that moves less and ends sooner than this is a tap, not a scrub or drag. */
const TAP_MAX_DISTANCE = 12;
const TAP_MAX_DURATION_MS = 300;

/** Whether the fullscreen media chrome (title bar and position badge) is shown. */
export type MediaChrome = {
  readonly opacity: SharedValue<number>;
  readonly toggle: () => void;
  readonly visible: boolean;
};

/** Owns the show/hide state of one fullscreen media viewer's chrome; a tap on the media toggles it. */
export function useMediaChrome(): MediaChrome {
  const [visible, setVisible] = useState(true);
  const opacity = useSharedValue(1);
  const toggle = useEvent((): void => {
    const next = !visible;
    setVisible(next);
    opacity.set(withTiming(next ? 1 : 0, { duration: CHROME_FADE_MS }));
  });
  return { opacity, toggle, visible };
}

/**
 * Reports taps on a view whose native child keeps its own touch handling (a
 * video player's controls). The handlers only observe the touch stream; they
 * never become the responder, so the child still receives the touch.
 */
export function useObservedTap(onTap: () => void): {
  readonly onTouchEnd: (event: GestureResponderEvent) => void;
  readonly onTouchStart: (event: GestureResponderEvent) => void;
} {
  const start = useRef<{ readonly time: number; readonly x: number; readonly y: number } | null>(
    null,
  );
  const onTouchStart = useEvent((event: GestureResponderEvent): void => {
    const { pageX, pageY, timestamp } = event.nativeEvent;
    start.current =
      event.nativeEvent.touches.length > 1 ? null : { time: timestamp, x: pageX, y: pageY };
  });
  const onTouchEnd = useEvent((event: GestureResponderEvent): void => {
    const began = start.current;
    start.current = null;
    if (began === null) {
      return;
    }
    const { pageX, pageY, timestamp } = event.nativeEvent;
    if (
      timestamp - began.time <= TAP_MAX_DURATION_MS &&
      Math.hypot(pageX - began.x, pageY - began.y) <= TAP_MAX_DISTANCE
    ) {
      onTap();
    }
  });
  return { onTouchEnd, onTouchStart };
}

/** The round dark button shared by the top bar's trailing actions. */
export const mediaPreviewButtonStyle = StyleSheet.create({
  button: {
    alignItems: "center",
    backgroundColor: "rgba(36,36,36,0.9)",
    borderRadius: radii.pill,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
}).button;
