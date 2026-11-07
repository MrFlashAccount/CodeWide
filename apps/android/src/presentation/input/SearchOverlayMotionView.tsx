import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Reanimated, {
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";

import { colors, layoutSize, radii, spacing } from "../../theme";

const SEARCH_PANEL_START_OFFSET = layoutSize.header - spacing.sm;

/** The dimmed origin stays mounted while the focused search panel slides upward. */
export function SearchOverlayMotion({
  children,
  onBackdropPress,
  progress,
}: {
  readonly children: ReactNode;
  readonly onBackdropPress: () => void;
  readonly progress: SharedValue<number>;
}): React.JSX.Element {
  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const panelStyle = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [
      {
        translateY: interpolate(progress.get(), [0, 1], [SEARCH_PANEL_START_OFFSET, 0]),
      },
    ],
  }));
  return (
    <View style={styles.root} testID="search-overlay">
      <Reanimated.View pointerEvents="none" style={[styles.backdrop, backdropStyle]} />
      <Pressable
        accessibilityLabel="Close search overlay"
        accessibilityRole="button"
        onPress={onBackdropPress}
        style={styles.backdropTarget}
      />
      <Reanimated.View style={[styles.panel, panelStyle]} testID="search-overlay-panel">
        {children}
      </Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.scrim,
  },
  backdropTarget: StyleSheet.absoluteFill,
  panel: {
    backgroundColor: colors.threadListSurface,
    borderTopLeftRadius: radii.medium,
    borderTopRightRadius: radii.medium,
    flex: 1,
    marginTop: spacing.sm,
    overflow: "hidden",
  },
  root: { flex: 1 },
});
