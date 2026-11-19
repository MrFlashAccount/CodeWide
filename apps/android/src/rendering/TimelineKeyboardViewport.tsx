import type { ReactElement, ReactNode } from "react";
import { StyleSheet } from "react-native";
import { useKeyboardContext } from "react-native-keyboard-controller";
import Animated, { useAnimatedStyle } from "react-native-reanimated";

/**
 * Sizes the Android chat viewport to the same visible edge as its sticky composer.
 * Layout lets LegendList retain its tail or reading anchor even if the IME skips frames.
 */
export function TimelineKeyboardViewport({
  children,
  offset,
}: {
  children: ReactNode;
  offset: number;
}): ReactElement {
  const { height, progress } = useKeyboardContext().reanimated;
  const style = useAnimatedStyle(() => ({
    marginBottom: Math.max(0, -height.get() - progress.get() * offset),
  }));
  return (
    <Animated.View style={[styles.viewport, style]} testID="conversation-keyboard-viewport">
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  viewport: {
    flex: 1,
    minHeight: 0,
  },
});
