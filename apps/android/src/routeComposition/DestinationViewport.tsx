import type { ReactNode } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  measure,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";

import { useEvent } from "../react/useEvent";
import { v1WorkspaceShellStyles } from "./WorkspaceShell.styles";
import { landedViewportMaxWidth } from "./paneFrames";
import type { PaneMotionState } from "./paneMotion";

/**
 * The native Stack publishes its screen size in a separate layout pass. When the destination
 * shrinks, its descendants must resolve percentages against the landed width even if the
 * enclosing screen still has its fullscreen width. Observe the unconstrained screen separately
 * so it can acknowledge the resize while the inner viewport is capped.
 */
export function DestinationViewport({
  children,
  geometry,
  testID,
}: {
  readonly children: ReactNode;
  readonly geometry: PaneMotionState;
  readonly testID: string;
}): React.JSX.Element {
  const screenWidth = useSharedValue(0);
  const maxWidth = useSharedValue<number | "100%">("100%");
  const onLayout = useEvent((event: LayoutChangeEvent) => {
    screenWidth.set(event.nativeEvent.layout.width);
  });
  const { frameWidth, moving } = geometry;
  useAnimatedReaction(
    () => ({
      basis: frameWidth.get(),
      moving: moving.get(),
      screen: screenWidth.get(),
    }),
    (current, previous) => {
      if (
        current.basis === 0 ||
        current.moving ||
        (previous?.moving !== true && maxWidth.get() === "100%")
      ) {
        maxWidth.set("100%");
        return;
      }
      // The screen can publish more than one intermediate width. Keep the cap until it fits.
      const measuredWidth = measure(geometry.frameRef)?.width ?? 0;
      maxWidth.set(landedViewportMaxWidth(geometry, measuredWidth, current.screen));
    },
  );
  const bounds = useAnimatedStyle(() => ({ maxWidth: maxWidth.get() }));
  return (
    <View
      onLayout={onLayout}
      style={[styles.viewport, v1WorkspaceShellStyles.paneFrame]}
      testID={testID}
    >
      <Animated.View style={[styles.viewport, bounds]}>{children}</Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
  },
});
