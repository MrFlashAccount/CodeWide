import { StyleSheet } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";

import { colors } from "../theme";
import type { ThreePanelsPane } from "../ui/threePanels";
import { paneScrimProgress } from "./paneDividerGeometry";
import type { PaneMotionState } from "./paneMotion";

const SCRIM_LAYER = 3;

/** Dims only the stationary surface as its neighbour slides over it. */
export function PaneDividerShade({
  geometry,
  pane,
}: {
  readonly geometry: PaneMotionState;
  readonly pane: ThreePanelsPane;
}): React.JSX.Element {
  const shade = useAnimatedStyle(() => {
    const drag = geometry.drag.get();
    if (drag === null) {
      return { opacity: 0 };
    }
    const width = geometry.frameWidth.get();
    const visible =
      pane === "left"
        ? drag.catalogVisibleWidth
        : pane === "center"
          ? drag.centerClipWidth
          : drag.rightVisibleWidth;
    return { opacity: paneScrimProgress(visible, width) };
  });
  return <Animated.View accessible={false} pointerEvents="none" style={[styles.shade, shade]} />;
}

const styles = StyleSheet.create({
  shade: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.scrim,
    zIndex: SCRIM_LAYER,
  },
});
