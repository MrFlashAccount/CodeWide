import { StyleSheet } from "react-native";
import Reanimated, { Extrapolation, interpolate, useAnimatedStyle } from "react-native-reanimated";

import { colors } from "../../theme";
import { useCatalogSearchPullModel } from "./catalogSearchPullModel";

const PULL_OVERLAY_START_DISTANCE = 10;
const PULL_OVERLAY_FULL_DISTANCE = 80;
const PULL_OVERLAY_HALF_OPACITY = 0.5;

/** Darkens catalog results while the fixed search trigger follows a pull gesture. */
export function CatalogSearchPullBackdrop({
  testID,
}: {
  readonly testID: string;
}): React.JSX.Element {
  const model = useCatalogSearchPullModel();
  const distance = model?.distance;
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(
      distance?.get() ?? 0,
      [0, PULL_OVERLAY_START_DISTANCE, PULL_OVERLAY_FULL_DISTANCE],
      [0, PULL_OVERLAY_HALF_OPACITY, 1],
      Extrapolation.CLAMP,
    ),
  }));
  return <Reanimated.View pointerEvents="none" style={[styles.backdrop, style]} testID={testID} />;
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.scrim,
  },
});
