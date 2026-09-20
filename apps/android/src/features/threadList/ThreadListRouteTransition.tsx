import type { ReactNode } from "react";
import { StyleSheet } from "react-native";
import Reanimated, { Keyframe } from "react-native-reanimated";

import { useReducedMotionPreference } from "../../rendering/reduced-motion-store";

const SEARCH_ROUTE_FADE_MS = 180;
const TRANSITION_END_PERCENT = 100;
const enter = new Keyframe({
  0: { opacity: 0 },
  [TRANSITION_END_PERCENT]: { opacity: 1 },
}).duration(SEARCH_ROUTE_FADE_MS);
const exit = new Keyframe({
  0: { opacity: 1 },
  [TRANSITION_END_PERCENT]: { opacity: 0 },
}).duration(SEARCH_ROUTE_FADE_MS);

/** Cross-fades the route-backed search surface without changing list ownership or geometry. */
export function ThreadListRouteTransition({
  children,
  routeKey,
}: {
  readonly children: ReactNode;
  readonly routeKey: "list" | "search";
}): React.JSX.Element {
  const reducedMotion = useReducedMotionPreference();
  if (routeKey === "list" || reducedMotion) {
    return (
      <Reanimated.View key={routeKey} style={styles.root} testID={`thread-list-route:${routeKey}`}>
        {children}
      </Reanimated.View>
    );
  }
  return (
    <Reanimated.View
      entering={enter}
      exiting={exit}
      key={routeKey}
      style={styles.root}
      testID={`thread-list-route:${routeKey}`}
    >
      {children}
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    minHeight: 0,
  },
});
