import type { ReactNode } from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import Reanimated, {
  Easing,
  type EntryAnimationsValues,
  type ExitAnimationsValues,
  Keyframe,
  useDerivedValue,
  withTiming,
} from "react-native-reanimated";

import { useReducedMotionPreference } from "../rendering/reduced-motion-store";
import { v1MobileRouteMotion } from "./v1MobileRouteMotion";

const TRANSITION_END_PERCENT = 100;
const FAST_OUT_SLOW_IN = Easing.bezier(...v1MobileRouteMotion.easingBezier);
const TIMING = {
  duration: v1MobileRouteMotion.durationMs,
  easing: FAST_OUT_SLOW_IN,
} as const;

type NavigationDirection = "back" | "forward";

const enterForward = new Keyframe({
  0: {
    opacity: 0,
    transform: [{ translateX: v1MobileRouteMotion.foregroundTravel.positivePercent }],
  },
  [TRANSITION_END_PERCENT]: {
    easing: FAST_OUT_SLOW_IN,
    opacity: 1,
    transform: [{ translateX: "0%" }],
  },
}).duration(v1MobileRouteMotion.durationMs);
const exitBack = new Keyframe({
  0: { opacity: 1, transform: [{ translateX: "0%" }] },
  [TRANSITION_END_PERCENT]: {
    easing: FAST_OUT_SLOW_IN,
    opacity: 0,
    transform: [{ translateX: v1MobileRouteMotion.foregroundTravel.positivePercent }],
  },
}).duration(v1MobileRouteMotion.durationMs);

/** Mirrors the V1 mobile native-stack push/pop transition inside one retained sheet shell. */
export function SheetPageTransition({
  children,
  direction,
  routeKey,
}: {
  readonly children: ReactNode;
  readonly direction: NavigationDirection | null;
  readonly routeKey: string;
}): React.JSX.Element {
  const reducedMotion = useReducedMotionPreference();
  const animatedDirection = useDerivedValue<NavigationDirection>(() => direction ?? "forward");
  const enterPage = ({ windowWidth }: EntryAnimationsValues) => {
    "worklet";
    const initialOffset =
      animatedDirection.get() === "forward"
        ? windowWidth * v1MobileRouteMotion.foregroundTravel.ratio
        : -windowWidth * v1MobileRouteMotion.backgroundTravel.ratio;
    return {
      animations: {
        opacity: withTiming(1, TIMING),
        transform: [{ translateX: withTiming(0, TIMING) }],
      },
      initialValues: { opacity: 0, transform: [{ translateX: initialOffset }] },
    };
  };
  const exitPage = ({ windowWidth }: ExitAnimationsValues) => {
    "worklet";
    const targetOffset =
      animatedDirection.get() === "forward"
        ? -windowWidth * v1MobileRouteMotion.backgroundTravel.ratio
        : windowWidth * v1MobileRouteMotion.foregroundTravel.ratio;
    return {
      animations: {
        opacity: withTiming(0, TIMING),
        transform: [{ translateX: withTiming(targetOffset, TIMING) }],
      },
      initialValues: { opacity: 1, transform: [{ translateX: 0 }] },
    };
  };
  if (reducedMotion) {
    return (
      <Reanimated.View key={routeKey} style={styles.page} testID={`sheet-page:${routeKey}`}>
        {children}
      </Reanimated.View>
    );
  }
  if (direction === null) {
    return (
      <Reanimated.View
        exiting={exitPage}
        key={routeKey}
        style={styles.page}
        testID={`sheet-page:${routeKey}`}
      >
        {children}
      </Reanimated.View>
    );
  }
  return (
    <Reanimated.View
      entering={enterPage}
      exiting={exitPage}
      key={routeKey}
      style={styles.page}
      testID={`sheet-page:${routeKey}`}
    >
      {children}
    </Reanimated.View>
  );
}

/** Pushes a detail layer over retained sheet content and reveals it again on Back. */
export function SheetDetailTransition({
  children,
  routeKey,
  style,
}: {
  readonly children: ReactNode;
  readonly routeKey: string;
  readonly style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const reducedMotion = useReducedMotionPreference();
  if (!reducedMotion) {
    return (
      <Reanimated.View
        entering={enterForward}
        exiting={exitBack}
        key={routeKey}
        style={[styles.detail, style]}
        testID={`sheet-detail:${routeKey}`}
      >
        {children}
      </Reanimated.View>
    );
  }
  return (
    <Reanimated.View
      key={routeKey}
      style={[styles.detail, style]}
      testID={`sheet-detail:${routeKey}`}
    >
      {children}
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  detail: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  page: {
    flex: 1,
    minHeight: 0,
    width: "100%",
  },
});
