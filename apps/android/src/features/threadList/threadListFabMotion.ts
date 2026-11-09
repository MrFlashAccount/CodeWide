import type { ViewStyle } from "react-native";
import { useSelector } from "@legendapp/state/react";
import {
  Easing,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { useReducedMotionPreference } from "../../rendering/reduced-motion-store";
import { v1MobileRouteMotion } from "../../ui/v1MobileRouteMotion";
import { FAB_STACK_HIDE_TRAVEL } from "./threadListFabGeometry";
import type { ThreadListFabModel } from "./threadListFabModel";

/** Duration of one floating action's hide or show transition. */
const THREAD_LIST_FAB_MOTION_MS = 200;
/**
 * Delay of the trailing action. The stack collapses from the top (mini voice
 * action first, New thread after it) and rebuilds from the bottom (New thread
 * first), so the larger primary action is the last to leave and the first to return.
 */
const THREAD_LIST_FAB_STAGGER_MS = 50;
/** Reduce Motion replaces travel, scale and blur with this plain fade. */
const THREAD_LIST_FAB_FADE_MS = 120;
const HIDDEN_SCALE = 0.8;
const HIDDEN_BLUR = 4;
// The established V1 fast_out_slow_in interpolator keeps the actions in step with route motion.
const MOTION_EASING = Easing.bezier(...v1MobileRouteMotion.easingBezier);

/** `primary` is New thread; `secondary` is the voice mini action above it. */
export type ThreadListFabRole = "primary" | "secondary";

/** The mini action leads a hide and New thread leads a show; Reduce Motion fades together. */
function transitionDelay(shown: boolean, role: ThreadListFabRole, reducedMotion: boolean): number {
  "worklet";
  const leads = shown ? role === "primary" : role === "secondary";
  return reducedMotion || leads ? 0 : THREAD_LIST_FAB_STAGGER_MS;
}

/** Animated presentation of one action plus its React-facing hidden state. */
export type ThreadListFabMotion = {
  readonly hidden: boolean;
  readonly style: ReturnType<typeof useAnimatedStyle<ViewStyle>>;
};

/**
 * Animates one floating action from the shared UI-thread visibility. `pinned`
 * keeps the action shown regardless of scroll.
 */
export function useThreadListFabMotion(
  model: ThreadListFabModel,
  role: ThreadListFabRole,
  pinned: boolean,
): ThreadListFabMotion {
  const reducedMotion = useReducedMotionPreference();
  const shown = useSelector(model.shown$);
  const visible = pinned || shown;
  // 0 is fully shown, 1 fully hidden.
  const progress = useSharedValue(visible ? 0 : 1);
  const { visibility } = model;
  useAnimatedReaction(
    () => pinned || visibility.get().shown,
    (next, previous) => {
      const target = next ? 0 : 1;
      if (next === previous || (previous === null && progress.get() === target)) {
        return;
      }
      progress.set(
        withDelay(
          transitionDelay(next, role, reducedMotion),
          withTiming(target, {
            duration: reducedMotion ? THREAD_LIST_FAB_FADE_MS : THREAD_LIST_FAB_MOTION_MS,
            easing: MOTION_EASING,
          }),
        ),
      );
    },
    [pinned, reducedMotion, role],
  );
  const style = useAnimatedStyle<ViewStyle>(() => {
    const hiddenAmount = progress.get();
    const spatial = reducedMotion ? 0 : hiddenAmount;
    return {
      // Android 12+ renders the blur natively; earlier versions ignore it.
      filter: [{ blur: spatial * HIDDEN_BLUR }],
      opacity: 1 - hiddenAmount,
      transform: [
        { translateY: spatial * FAB_STACK_HIDE_TRAVEL },
        { scale: 1 - (1 - HIDDEN_SCALE) * spatial },
      ],
    };
  });
  return { hidden: !visible, style };
}
