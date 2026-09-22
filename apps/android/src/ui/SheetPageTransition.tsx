import { useInsertionEffect, type ReactNode } from "react";
import { I18nManager, Platform, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import Reanimated, {
  Easing,
  type EntryAnimationsValues,
  type ExitAnimationsValues,
  Keyframe,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { runOnUISync } from "react-native-worklets";

import { useReducedMotionPreference } from "../rendering/reduced-motion-store";
import { v1MobileRouteMotion } from "./v1MobileRouteMotion";

const TRANSITION_END_PERCENT = 100;
const FAST_OUT_SLOW_IN = Easing.bezier(...v1MobileRouteMotion.easingBezier);
const TIMING = {
  duration: v1MobileRouteMotion.durationMs,
  easing: FAST_OUT_SLOW_IN,
} as const;

type NavigationDirection = "back" | "forward";

function detailMotion(isRTL: boolean) {
  const edge =
    `${isRTL ? "-" : ""}${v1MobileRouteMotion.foregroundTravel.positivePercent}` as const;
  const enterForward = new Keyframe({
    0: {
      opacity: 0,
      transform: [{ translateX: edge }],
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
      transform: [{ translateX: edge }],
    },
  }).duration(v1MobileRouteMotion.durationMs);

  return { enterForward, exitBack };
}

/** Uses opposing push/pop directions inside a retained sheet, with V1 route timing and distances. */
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
  const side = I18nManager.isRTL ? -1 : 1;
  const outgoingRatio =
    side *
    (direction === "back"
      ? v1MobileRouteMotion.foregroundTravel.ratio
      : -v1MobileRouteMotion.backgroundTravel.ratio);
  const exitRatio = useSharedValue(outgoingRatio);
  useInsertionEffect(() => {
    const publish = () => {
      "worklet";
      exitRatio.set(outgoingRatio);
    };
    // WHY: Fabric commits the host container after descendant insertion effects.
    // Publish synchronously before that commit can start the removed page's saved
    // exit worklet. A passive mapper (or queued UI write) can leave it one route late.
    if (Platform.OS === "web") {
      publish();
    } else {
      runOnUISync(publish);
    }
  }, [exitRatio, outgoingRatio]);
  const enterPage = ({ windowWidth }: EntryAnimationsValues) => {
    "worklet";
    const initialOffset =
      side *
      windowWidth *
      (direction === "forward"
        ? v1MobileRouteMotion.foregroundTravel.ratio
        : -v1MobileRouteMotion.backgroundTravel.ratio);
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
    const targetOffset = windowWidth * exitRatio.get();
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
    const { enterForward, exitBack } = detailMotion(I18nManager.isRTL);
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
