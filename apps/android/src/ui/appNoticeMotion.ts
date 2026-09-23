import { useEffect, useRef } from "react";
import { useWindowDimensions, type ViewStyle } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { useConstant } from "../react/useConstant";
import { useEvent } from "../react/useEvent";

const SWIPE_THRESHOLD = 45;
const SWIPE_VELOCITY = 300;
const EXIT_DURATION_MS = 200;
const GLIDE_DAMPING = 32;
const GLIDE_STIFFNESS = 170;
const RELEASE_DAMPING = 24;
const RELEASE_MASS = 0.8;
const RELEASE_STIFFNESS = 280;
const COLLAPSED_SCALE_MIN = 0.8;
const COLLAPSED_SCALE_STEP = 0.05;
const STACK_ANIMATION_MS = 300;
const MEASURE_GRACE_MS = 100;
const SWIPE_FADE_DISTANCE = 200;
const FALLBACK_CARD_HEIGHT = 56;
const ENTRANCE_INSET = 16;
const ENTRANCE_SCALE_BASE = 0.94;
const ENTRANCE_SCALE_SPAN = 0.06;
const SWIPE_ACTIVATION = 8;
const SWIPE_AXIS_LOCK = 4;
const SWIPE_AXIS_HORIZONTAL = 1;
const SWIPE_AXIS_VERTICAL = 2;
const COUNTER_SWIPE_RESISTANCE = 0.2;
const UPPER_EXIT_RATIO = 0.6;
const glideSpring = { damping: GLIDE_DAMPING, mass: 1, stiffness: GLIDE_STIFFNESS };
const releaseSpring = {
  damping: RELEASE_DAMPING,
  mass: RELEASE_MASS,
  stiffness: RELEASE_STIFFNESS,
};

type SwipeExit =
  | { readonly direction: number; readonly kind: "horizontal" }
  | { readonly kind: "up" }
  | { readonly kind: "none" };

function resolveSwipeExit(motion: {
  readonly velocityX: number;
  readonly velocityY: number;
  readonly x: number;
  readonly y: number;
}): SwipeExit {
  if (Math.abs(motion.x) > Math.abs(motion.y)) {
    return resolveHorizontalSwipeExit(motion.x, motion.velocityX);
  }
  if (
    motion.y < 0 &&
    (Math.abs(motion.y) >= SWIPE_THRESHOLD || motion.velocityY <= -SWIPE_VELOCITY)
  ) {
    return { kind: "up" };
  }
  return { kind: "none" };
}

function resolveHorizontalSwipeExit(x: number, velocityX: number): SwipeExit {
  if (Math.abs(x) < SWIPE_THRESHOLD && Math.abs(velocityX) < SWIPE_VELOCITY) {
    return { kind: "none" };
  }
  const direction = Math.sign(x === 0 ? velocityX : x);
  return { direction: direction === 0 ? 1 : direction, kind: "horizontal" };
}

function collapsedScale(index: number): number {
  return Math.max(COLLAPSED_SCALE_MIN, 1 - index * COLLAPSED_SCALE_STEP);
}

/** Owns measured entry, stacked spring motion, and swipe exit for one toast. */
export function useAppNoticeMotion({
  expanded,
  height,
  index,
  offset,
  onInteractingChange,
  onSwipeDismiss,
  visible,
}: {
  readonly expanded: boolean;
  readonly height: number;
  readonly index: number;
  readonly offset: number;
  readonly onInteractingChange: (interacting: boolean) => void;
  readonly onSwipeDismiss: () => void;
  readonly visible: boolean;
}): {
  readonly close: () => boolean;
  readonly pan: ReturnType<typeof Gesture.Pan>;
  readonly style: ReturnType<typeof useAnimatedStyle<ViewStyle>>;
} {
  const { height: screenHeight, width: screenWidth } = useWindowDimensions();
  const entered = useRef(false);
  const closing = useRef(false);
  const presence = useSharedValue(0);
  const positionY = useSharedValue(offset);
  const scale = useSharedValue(expanded ? 1 : collapsedScale(index));
  const opacity = useSharedValue(visible ? 1 : 0);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  const lockedAxis = useSharedValue(0);
  const dismissWidth = useSharedValue(screenWidth);
  const dismissHeight = useSharedValue(screenHeight);
  const swipeDismiss = useEvent(onSwipeDismiss);

  const close = useEvent((): boolean => {
    if (closing.current) {
      return false;
    }
    closing.current = true;
    presence.set(
      withTiming(0, { duration: EXIT_DURATION_MS }, (finished) => {
        if (finished === true) {
          scheduleOnRN(swipeDismiss);
        }
      }),
    );
    return true;
  });

  useEffect(() => {
    dismissWidth.set(screenWidth);
    dismissHeight.set(screenHeight);
  }, [dismissHeight, dismissWidth, screenHeight, screenWidth]);
  useEffect(() => {
    positionY.set(withSpring(offset, glideSpring));
    scale.set(withSpring(expanded ? 1 : collapsedScale(index), glideSpring));
    opacity.set(withTiming(visible ? 1 : 0, { duration: STACK_ANIMATION_MS }));
  }, [expanded, index, offset, opacity, positionY, scale, visible]);
  useEffect(() => {
    if (entered.current || height <= 0) {
      return;
    }
    entered.current = true;
    presence.set(withSpring(1, glideSpring));
  }, [height, presence]);
  useEffect(() => {
    if (entered.current) {
      return undefined;
    }
    const timeout = setTimeout(() => {
      if (entered.current) {
        return;
      }
      entered.current = true;
      presence.set(withSpring(1, glideSpring));
    }, MEASURE_GRACE_MS);
    return () => {
      clearTimeout(timeout);
    };
  }, [presence]);

  const style = useAnimatedStyle(() => {
    const present = presence.get();
    const travel = Math.abs(dragX.get()) + Math.abs(dragY.get());
    const measuredHeight = height > 0 ? height : FALLBACK_CARD_HEIGHT;
    return {
      opacity: opacity.get() * present * (1 - Math.min(1, travel / SWIPE_FADE_DISTANCE)),
      transform: [
        { translateX: dragX.get() },
        {
          translateY:
            positionY.get() - (1 - present) * (measuredHeight + ENTRANCE_INSET) + dragY.get(),
        },
        { scale: scale.get() * (ENTRANCE_SCALE_BASE + ENTRANCE_SCALE_SPAN * present) },
      ],
    };
  });

  const pan = useConstant(() =>
    Gesture.Pan()
      .activeOffsetX([-SWIPE_ACTIVATION, SWIPE_ACTIVATION])
      .activeOffsetY([-SWIPE_ACTIVATION, SWIPE_ACTIVATION])
      .onBegin(() => {
        scheduleOnRN(onInteractingChange, true);
      })
      .onUpdate((event) => {
        if (lockedAxis.get() === 0) {
          const horizontal = Math.abs(event.translationX);
          const vertical = Math.abs(event.translationY);
          if (horizontal > SWIPE_AXIS_LOCK || vertical > SWIPE_AXIS_LOCK) {
            lockedAxis.set(horizontal >= vertical ? SWIPE_AXIS_HORIZONTAL : SWIPE_AXIS_VERTICAL);
          }
        }
        if (lockedAxis.get() === SWIPE_AXIS_HORIZONTAL) {
          dragX.set(event.translationX);
        } else if (lockedAxis.get() === SWIPE_AXIS_VERTICAL) {
          dragY.set(
            event.translationY < 0
              ? event.translationY
              : event.translationY * COUNTER_SWIPE_RESISTANCE,
          );
        }
      })
      .onEnd((event) => {
        const exit = resolveSwipeExit({
          velocityX: event.velocityX,
          velocityY: event.velocityY,
          x: dragX.get(),
          y: dragY.get(),
        });
        if (exit.kind === "horizontal") {
          dragX.set(
            withTiming(
              exit.direction * dismissWidth.get(),
              { duration: EXIT_DURATION_MS },
              (finished) => {
                if (finished === true) {
                  scheduleOnRN(swipeDismiss);
                }
              },
            ),
          );
        } else if (exit.kind === "up") {
          dragY.set(
            withTiming(
              -dismissHeight.get() * UPPER_EXIT_RATIO,
              { duration: EXIT_DURATION_MS },
              (finished) => {
                if (finished === true) {
                  scheduleOnRN(swipeDismiss);
                }
              },
            ),
          );
        } else {
          dragX.set(withSpring(0, releaseSpring));
          dragY.set(withSpring(0, releaseSpring));
        }
      })
      .onFinalize(() => {
        lockedAxis.set(0);
        scheduleOnRN(onInteractingChange, false);
      }),
  );
  return { close, pan, style };
}
