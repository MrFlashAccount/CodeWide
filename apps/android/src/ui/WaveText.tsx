import MaskedView from "@expo/ui/community/masked-view";
import { useEffect, useState } from "react";
import { Platform, type StyleProp, StyleSheet, View, type TextStyle, type ViewStyle } from "react-native";
import Reanimated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { useReducedMotionPreference } from "../rendering/reduced-motion-store";
import { AppText as Text } from "./Typography";

export function WaveText({
  text,
  style,
  containerStyle,
  testID = "active-text-shimmer",
}: {
  text: string;
  style: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const reducedMotion = useReducedMotionPreference();
  const animated = !reducedMotion && Platform.OS !== "web";
  const [width, setWidth] = useState(0);
  const progress = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(progress);
    progress.value = !animated
      ? 0
      : withRepeat(withTiming(1, { duration: 1_700, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(progress);
  }, [animated, progress]);
  const bandWidth = Math.max(28, width * 0.46);
  const animatedBandStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -bandWidth + progress.value * (width + bandWidth) }],
  }), [bandWidth, width]);
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={text}
      onLayout={(event) => {
        const nextWidth = event.nativeEvent?.layout?.width;
        if (typeof nextWidth !== "number" || !Number.isFinite(nextWidth)) return;
        setWidth((current) => current === nextWidth ? current : nextWidth);
      }}
      style={[styles.shell, containerStyle]}
    >
      <Text numberOfLines={1} ellipsizeMode="tail" style={[style, animated && styles.rest]}>{text}</Text>
      {animated && width > 0 && (
        <MaskedView
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          maskElement={<Text numberOfLines={1} ellipsizeMode="tail" style={[style, styles.mask]}>{text}</Text>}
        >
          <Reanimated.View style={[styles.band, { width: bandWidth }, animatedBandStyle]} />
        </MaskedView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { minWidth: 0, maxWidth: "100%", flexShrink: 1, alignSelf: "center", justifyContent: "center", overflow: "hidden" },
  rest: { opacity: 0.58 },
  mask: { color: "#000000" },
  band: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    experimental_backgroundImage: "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.08) 24%, rgba(255,255,255,0.72) 42%, rgba(255,255,255,1) 50%, rgba(255,255,255,0.72) 58%, rgba(255,255,255,0.08) 76%, rgba(255,255,255,0) 100%)",
  },
});
