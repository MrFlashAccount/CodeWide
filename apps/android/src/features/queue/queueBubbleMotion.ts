import { useEffect } from "react";
import { Gesture } from "react-native-gesture-handler";
import {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useEvent } from "../../react/useEvent";
import { spacing } from "../../theme";
import type { AnimatedQueueBubbleProps } from "./inlineQueueContract";
import { CARD_GAP, ENTRY_OFFSET, STACK_HEIGHT, SWIPE_REVEAL } from "./inlineQueueLayout";
import {
  QUEUE_SPRING_GLIDE,
  QUEUE_SPRING_SNAPPY,
  SWIPE_EASING,
  playCommitHaptic,
  playTargetHaptic,
  resistedSwipe,
} from "./queueMotionPolicy";
export function useQueueBubbleMotion(props: AnimatedQueueBubbleProps) {
  const {
    deleteEnabled,
    expanded,
    index,
    itemCount,
    measuredHeight,
    reorderEnabled,
    steerEnabled,
    swipeDismissDistance,
    targetOpacity,
    targetScale,
    targetY,
    onDelete,
    onReorder,
    onSteer,
  } = props;

  const layoutY = useSharedValue(targetY + STACK_HEIGHT + ENTRY_OFFSET);
  const layoutScale = useSharedValue(0.94);
  const presence = useSharedValue(0);
  const animatedHeight = useSharedValue<number>(STACK_HEIGHT);
  const dismissOpacity = useSharedValue(1);
  const swipeX = useSharedValue(0);
  const swipeStartX = useSharedValue(0);
  const swipeDirection = useSharedValue<-1 | 0 | 1>(0);
  const swipeArmed = useSharedValue(false);
  const hapticPlayed = useSharedValue(false);
  const dragY = useSharedValue(0);
  const dragging = useSharedValue(false);
  const cardWidth = useSharedValue(0);
  const deleteItem = useEvent(async () => {
    const succeeded = await onDelete();
    if (!succeeded) {
      dismissOpacity.set(withTiming(1, { duration: 120 }));
      swipeX.set(withSpring(0, QUEUE_SPRING_SNAPPY));
    }
  });
  const steerItem = useEvent(async () => {
    const succeeded = await onSteer();
    if (!succeeded) {
      dismissOpacity.set(withTiming(1, { duration: 120 }));
      swipeX.set(withSpring(0, QUEUE_SPRING_SNAPPY));
    }
  });
  const reorderItem = useEvent((offset: number) => {
    if (offset !== 0) void onReorder(offset);
  });

  useEffect(() => {
    layoutY.set(withSpring(targetY, QUEUE_SPRING_GLIDE));
    layoutScale.set(withSpring(targetScale, QUEUE_SPRING_GLIDE));
    presence.set(withTiming(targetOpacity, { duration: 300 }));
    animatedHeight.set(withSpring(measuredHeight, QUEUE_SPRING_GLIDE));
  }, [
    animatedHeight,
    layoutScale,
    layoutY,
    measuredHeight,
    presence,
    targetOpacity,
    targetScale,
    targetY,
  ]);

  const cardStyle = useAnimatedStyle(() => ({
    height: animatedHeight.get(),
    opacity: presence.get() * dismissOpacity.get(),
    transform: [
      { translateY: layoutY.get() + dragY.get() },
      { scale: layoutScale.get() * (dragging.get() ? 1.025 : 1) },
    ],
    zIndex: dragging.get() ? itemCount + 10 : expanded ? 1 : itemCount - index,
  }));
  const swipeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: swipeX.get() }],
  }));
  const steerRevealStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, swipeX.get() / SWIPE_REVEAL)),
  }));
  const deleteRevealStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, -swipeX.get() / SWIPE_REVEAL)),
  }));

  const commitSwipe = (direction: -1 | 1): void => {
    "worklet";
    const distance = Math.max(swipeDismissDistance, cardWidth.get() + spacing.md);
    dismissOpacity.set(withDelay(170, withTiming(0, { duration: 100, easing: SWIPE_EASING })));
    swipeX.set(
      withTiming(direction * distance, { duration: 330, easing: SWIPE_EASING }, (finished) => {
        if (!finished) return;
        runOnJS(playCommitHaptic)();
        if (direction < 0) runOnJS(deleteItem)();
        else runOnJS(steerItem)();
      }),
    );
  };

  const swipeGesture = Gesture.Pan()
    .withTestId("queued-prompt-swipe")
    .enabled(deleteEnabled || steerEnabled)
    .activeOffsetX([-8, 8])
    .failOffsetY([-16, 16])
    .maxPointers(1)
    .onBegin(() => {
      dismissOpacity.set(1);
      swipeStartX.set(swipeX.get());
      swipeDirection.set(swipeX.get() < 0 ? -1 : swipeX.get() > 0 ? 1 : 0);
      swipeArmed.set(false);
      hapticPlayed.set(false);
    })
    .onUpdate((event) => {
      const rawTranslation = swipeStartX.get() + event.translationX;
      if (rawTranslation <= -8 && deleteEnabled) swipeDirection.set(-1);
      else if (rawTranslation >= 8 && steerEnabled) swipeDirection.set(1);
      else if (Math.abs(rawTranslation) < 8) swipeDirection.set(0);
      const direction = swipeDirection.get();
      if (direction === 0 || Math.sign(rawTranslation) !== direction) {
        swipeX.set(0);
        return;
      }
      const distance = Math.abs(rawTranslation);
      swipeX.set(direction * resistedSwipe(distance));
      const commitDistance = Math.min(
        Math.max(cardWidth.get() * 0.5, SWIPE_REVEAL + 24),
        SWIPE_REVEAL + 48,
      );
      const nextArmed = distance >= commitDistance;
      swipeArmed.set(nextArmed);
      if (nextArmed && !hapticPlayed.get()) {
        hapticPlayed.set(true);
        runOnJS(playTargetHaptic)();
      }
      if (!nextArmed) hapticPlayed.set(false);
    })
    .onEnd((event, success) => {
      const direction = swipeDirection.get();
      const rawTranslation = swipeStartX.get() + event.translationX;
      const velocityCommit =
        Math.abs(event.velocityX) >= 1_600 && Math.sign(event.velocityX) === direction;
      if (success && direction !== 0 && (swipeArmed.get() || velocityCommit)) {
        commitSwipe(direction);
        return;
      }
      if (success && direction !== 0 && Math.abs(rawTranslation) >= SWIPE_REVEAL / 2) {
        swipeX.set(withTiming(direction * SWIPE_REVEAL, { duration: 370, easing: SWIPE_EASING }));
        return;
      }
      swipeX.set(withSpring(0, QUEUE_SPRING_SNAPPY));
    })
    .onFinalize((_event, success) => {
      if (!success) swipeX.set(withSpring(0, QUEUE_SPRING_SNAPPY));
      swipeDirection.set(0);
      swipeStartX.set(swipeX.get());
      swipeArmed.set(false);
      hapticPlayed.set(false);
    });

  const reorderGesture = Gesture.Pan()
    .withTestId("queued-prompt-reorder")
    .enabled(expanded && reorderEnabled && itemCount > 1)
    .activateAfterLongPress(240)
    .failOffsetX([-16, 16])
    .maxPointers(1)
    .onStart(() => {
      dragging.set(true);
      runOnJS(playTargetHaptic)();
    })
    .onUpdate((event) => {
      dragY.set(event.translationY);
    })
    .onEnd((event, success) => {
      if (!success) return;
      const rowHeight = Math.max(STACK_HEIGHT, measuredHeight) + CARD_GAP;
      const requestedOffset = Math.round(-event.translationY / rowHeight);
      const offset = Math.max(-index, Math.min(itemCount - index - 1, requestedOffset));
      if (offset !== 0) runOnJS(reorderItem)(offset);
    })
    .onFinalize(() => {
      dragY.set(withSpring(0, QUEUE_SPRING_SNAPPY));
      dragging.set(false);
    });
  return {
    cardWidth,
    cardStyle,
    steerRevealStyle,
    deleteRevealStyle,
    steerItem,
    deleteItem,
    reorderGesture,
    swipeGesture,
    swipeStyle,
  };
}
