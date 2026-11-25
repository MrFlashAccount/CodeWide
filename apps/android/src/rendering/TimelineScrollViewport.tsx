import { useContext, type ReactElement } from "react";
import {
  Platform,
  requireNativeComponent,
  StyleSheet,
  View,
  type ScrollViewProps,
  type ViewProps,
} from "react-native";
import Animated, { createAnimatedComponent, useAnimatedProps } from "react-native-reanimated";

import { PaneBodyPlacementContext } from "../ui/paneBodyTransition";

type ScrollHostProps = ViewProps & {
  readonly endThresholdRatio: number;
  readonly paneMoving?: boolean;
};

const AnimatedScrollHost =
  Platform.OS === "android"
    ? createAnimatedComponent(requireNativeComponent<ScrollHostProps>("CodeWideTimelineScrollHost"))
    : null;

/** Keeps the current reading row anchored while a pane changes width. */
export function TimelineScrollViewport({
  scrollProps,
  threshold,
}: {
  readonly scrollProps: ScrollViewProps;
  readonly threshold: number;
}): ReactElement {
  const moving = useContext(PaneBodyPlacementContext)?.resizing;
  const animatedProps = useAnimatedProps(() => ({ paneMoving: moving?.get() ?? false }));
  const { maintainVisibleContentPosition: position, ...otherScrollProps } = scrollProps;
  const follow = useAnimatedProps(() => ({
    // Android's default anchor tracks LegendList's spacer during Fabric mounts. The pane
    // resize owns the actual reading row until the divider lands.
    maintainVisibleContentPosition: moving?.get() === true ? null : (position ?? null),
  }));
  if (AnimatedScrollHost === null) {
    return (
      <View style={styles.viewport}>
        <Animated.ScrollView {...scrollProps} />
      </View>
    );
  }
  return (
    <AnimatedScrollHost
      animatedProps={animatedProps}
      endThresholdRatio={threshold}
      style={styles.viewport}
    >
      <Animated.ScrollView {...otherScrollProps} animatedProps={follow} />
    </AnimatedScrollHost>
  );
}

const styles = StyleSheet.create({
  viewport: { flex: 1 },
});
