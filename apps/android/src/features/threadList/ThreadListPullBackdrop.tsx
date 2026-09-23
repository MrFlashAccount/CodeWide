import { StyleSheet } from "react-native";
import Reanimated, { Extrapolation, interpolate, useAnimatedStyle } from "react-native-reanimated";

import { colors } from "../../theme";
import { useThreadListSearchPullModel } from "./threadListSearchPull";

const PULL_OVERLAY_START_DISTANCE = 10;
const PULL_OVERLAY_FULL_DISTANCE = 80;
const PULL_OVERLAY_HALF_OPACITY = 0.5;

/** The list darkens progressively during a pull while its fixed search row remains visible. */
export function ThreadListPullBackdrop(): React.JSX.Element {
  const model = useThreadListSearchPullModel();
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(
      model?.distance.get() ?? 0,
      [0, PULL_OVERLAY_START_DISTANCE, PULL_OVERLAY_FULL_DISTANCE],
      [0, PULL_OVERLAY_HALF_OPACITY, 1],
      Extrapolation.CLAMP,
    ),
  }));
  return (
    <Reanimated.View
      pointerEvents="none"
      style={[styles.backdrop, style]}
      testID="thread-list-pull-backdrop"
    />
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.scrim,
  },
});
