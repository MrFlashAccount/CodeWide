import { useEffect } from "react";
import { useWindowDimensions, type LayoutChangeEvent, type ViewStyle } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useEvent } from "../../react/useEvent";
import { useReducedMotionPreference } from "../../rendering/reduced-motion-store";

const ACTIVATION_DISTANCE = 8;
const HORIZONTAL_TOLERANCE = 12;

const COLLAPSE_DISTANCE = 70;
const FLING_DISTANCE = 16;
const FLING_VELOCITY = 900;
const SETTLE_DURATION_MS = 180;
const OPEN_DURATION_MS = 240;

/** Moves only the grip's sheet; a presentation fence rejects delayed collapse from an old route. */
export function useBrowserSheetMotion(props: {
  readonly active: boolean;
  readonly onCollapse: () => void;
  readonly presentationId: string;
}): {
  readonly animatedStyle: ReturnType<typeof useAnimatedStyle<ViewStyle>>;
  readonly gesture: ReturnType<typeof Gesture.Pan>;
  readonly onLayout: (event: LayoutChangeEvent) => void;
} {
  const reducedMotion = useReducedMotionPreference();
  const viewport = useWindowDimensions();
  const translation = useSharedValue(viewport.height);
  const height = useSharedValue(viewport.height);
  const collapsing = useSharedValue(false);
  const collapse = useEvent((presentationId: string): void => {
    if (props.active && presentationId === props.presentationId) {
      props.onCollapse();
    }
  });
  const onLayout = useEvent((event: LayoutChangeEvent): void => {
    height.set(event.nativeEvent.layout.height);
  });
  useEffect(() => {
    cancelAnimation(translation);
    translation.set(height.get());
    if (props.active) {
      translation.set(withTiming(0, { duration: reducedMotion ? 0 : OPEN_DURATION_MS }));
    }
    collapsing.set(false);
    return () => {
      cancelAnimation(translation);
    };
  }, [collapsing, height, props.active, props.presentationId, reducedMotion, translation]);
  const presentationId = props.presentationId;
  const duration = reducedMotion ? 0 : SETTLE_DURATION_MS;
  const gesture = Gesture.Pan()
    .withTestId("browser-sheet-grip-pan")
    .enabled(props.active)
    .maxPointers(1)
    .activeOffsetY(ACTIVATION_DISTANCE)
    .failOffsetX([-HORIZONTAL_TOLERANCE, HORIZONTAL_TOLERANCE])
    .onBegin(() => {
      if (!collapsing.get()) {
        cancelAnimation(translation);
      }
    })
    .onUpdate((event) => {
      if (!collapsing.get()) {
        translation.set(Math.max(0, event.translationY));
      }
    })
    .onEnd((event, success) => {
      if (!success || collapsing.get()) {
        return;
      }
      const distance = Math.max(0, event.translationY);
      if (
        distance >= COLLAPSE_DISTANCE ||
        (distance >= FLING_DISTANCE && event.velocityY >= FLING_VELOCITY)
      ) {
        collapsing.set(true);
        translation.set(
          withTiming(Math.max(height.get(), distance), { duration }, (finished) => {
            if (finished === true) {
              scheduleOnRN(collapse, presentationId);
            }
          }),
        );
      }
    })
    .onFinalize(() => {
      if (!collapsing.get()) {
        translation.set(withTiming(0, { duration }));
      }
    });
  const animatedStyle = useAnimatedStyle<ViewStyle>(() => ({
    transform: [{ translateY: translation.get() }],
  }));
  return { animatedStyle, gesture, onLayout };
}
