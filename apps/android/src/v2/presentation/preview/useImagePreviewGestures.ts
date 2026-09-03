import { Gesture } from "react-native-gesture-handler";
import type { ViewStyle } from "react-native";
import {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type AnimatedStyle,
} from "react-native-reanimated";

import { useEvent } from "../../../react/useEvent";
import {
  clampImageTranslation,
  doubleTapImageTranslation,
  IMAGE_PREVIEW_DOUBLE_TAP_SCALE,
  IMAGE_PREVIEW_MAX_SCALE,
  resolveImagePreviewAxis,
  shouldDismissImage,
  shouldNavigateImage,
  type ImagePreviewGestureAxis,
  type ImagePreviewSize,
} from "./imagePreviewGestureModel";

interface ImagePreviewGestureOptions {
  canGoNext: boolean;
  canGoPrevious: boolean;
  fitted: ImagePreviewSize;
  onClose?(): void;
  onNext(): void;
  onPrevious(): void;
  viewport: ImagePreviewSize;
}

interface ImagePreviewGestures {
  backdropStyle: AnimatedStyle<ViewStyle>;
  gesture: ReturnType<(typeof Gesture)["Simultaneous"]>;
  imageStyle: AnimatedStyle<ViewStyle>;
}

const TIMING = { duration: 110, easing: Easing.out(Easing.cubic) };

/** Owns the V2 full-screen image gesture state independently of its source. */
export function useImagePreviewGestures(options: ImagePreviewGestureOptions): ImagePreviewGestures {
  const { canGoNext, canGoPrevious, fitted, onClose, onNext, onPrevious, viewport } = options;
  const canDismiss = onClose !== undefined;
  const close = useEvent(() => onClose?.());
  const navigate = useEvent((direction: -1 | 1) => {
    if (direction < 0) onPrevious();
    else onNext();
  });
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  const pageOffset = useSharedValue(0);
  const dismissOpacity = useSharedValue(1);
  const gestureAxis = useSharedValue<ImagePreviewGestureAxis>(0);
  const pan = Gesture.Pan()
    .minDistance(4)
    .averageTouches(true)
    .onBegin(() => {
      savedX.set(translateX.get());
      savedY.set(translateY.get());
      gestureAxis.set(scale.get() > 1.01 ? 3 : 0);
    })
    .onUpdate((event) => {
      if (scale.get() > 1.01 || event.numberOfPointers > 1) {
        gestureAxis.set(3);
        const bounded = clampImageTranslation(
          { x: savedX.get() + event.translationX, y: savedY.get() + event.translationY },
          fitted,
          viewport,
          scale.get(),
        );
        translateX.set(bounded.x);
        translateY.set(bounded.y);
        return;
      }
      if (gestureAxis.get() === 0) {
        gestureAxis.set(resolveImagePreviewAxis(event.translationX, event.translationY));
      }
      if (gestureAxis.get() === 1) {
        translateY.set(0);
        dismissOpacity.set(1);
        pageOffset.set(event.translationX);
      } else if (gestureAxis.get() === 2 && canDismiss) {
        pageOffset.set(0);
        translateY.set(event.translationY);
        dismissOpacity.set(
          Math.max(0.35, 1 - Math.abs(event.translationY) / Math.max(1, viewport.height * 0.55)),
        );
      }
    })
    .onEnd((event) => {
      if (gestureAxis.get() === 3 || scale.get() > 1.01) {
        gestureAxis.set(0);
        return;
      }
      if (gestureAxis.get() === 1) {
        const direction = event.translationX < 0 ? 1 : -1;
        const allowed = direction > 0 ? canGoNext : canGoPrevious;
        if (allowed && shouldNavigateImage(event.translationX, event.velocityX, viewport.width)) {
          pageOffset.set(
            withTiming(direction > 0 ? -viewport.width : viewport.width, TIMING, (finished) => {
              if (finished === true) runOnJS(navigate)(direction);
            }),
          );
        } else {
          pageOffset.set(withTiming(0, TIMING));
        }
      } else if (
        gestureAxis.get() === 2 &&
        canDismiss &&
        shouldDismissImage(event.translationY, event.velocityY, viewport.height)
      ) {
        translateY.set(
          withTiming(
            event.translationY < 0 ? -viewport.height : viewport.height,
            TIMING,
            (finished) => {
              if (finished === true) runOnJS(close)();
            },
          ),
        );
        dismissOpacity.set(withTiming(0, TIMING));
      } else {
        translateY.set(withTiming(0, TIMING));
        dismissOpacity.set(withTiming(1, TIMING));
      }
      gestureAxis.set(0);
    });

  const pinch = Gesture.Pinch()
    .onBegin(() => savedScale.set(scale.get()))
    .onUpdate((event) => {
      scale.set(Math.max(1, Math.min(IMAGE_PREVIEW_MAX_SCALE, savedScale.get() * event.scale)));
    })
    .onEnd(() => {
      const targetScale = scale.get() < 1.04 ? 1 : scale.get();
      const bounded = clampImageTranslation(
        {
          x: targetScale === 1 ? 0 : translateX.get(),
          y: targetScale === 1 ? 0 : translateY.get(),
        },
        fitted,
        viewport,
        targetScale,
      );
      scale.set(withTiming(targetScale, TIMING));
      translateX.set(withTiming(bounded.x, TIMING));
      translateY.set(withTiming(bounded.y, TIMING));
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(260)
    .onEnd((event, success) => {
      if (!success) return;
      const zoomed = scale.get() > 1.01;
      const translation = zoomed
        ? { x: 0, y: 0 }
        : doubleTapImageTranslation({ x: event.x, y: event.y }, fitted, viewport);
      scale.set(withTiming(zoomed ? 1 : IMAGE_PREVIEW_DOUBLE_TAP_SCALE, TIMING));
      translateX.set(withTiming(translation.x, TIMING));
      translateY.set(withTiming(translation.y, TIMING));
    });

  return {
    backdropStyle: useAnimatedStyle(() => ({ opacity: dismissOpacity.get() })),
    gesture: Gesture.Simultaneous(pan, pinch, doubleTap),
    imageStyle: useAnimatedStyle(() => ({
      transform: [
        { translateX: translateX.get() + pageOffset.get() },
        { translateY: translateY.get() },
        { scale: scale.get() },
      ],
    })),
  };
}
