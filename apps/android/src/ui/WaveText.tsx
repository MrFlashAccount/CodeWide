import {
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { usePerformanceExperiment } from "../data/performance-experiments";
import { NativeShimmerText } from "../presentation/text/nativeShimmerText";
import { useReducedMotionPreference } from "../rendering/reduced-motion-store";
import { AppText as Text, productFontStyle } from "./Typography";

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
  const textShimmerDisabled = usePerformanceExperiment("disableTextShimmer");
  const animated = !reducedMotion && !textShimmerDisabled;
  if (!animated || NativeShimmerText === null) {
    return (
      <View testID={testID} accessible accessibilityRole="text" accessibilityLabel={text} style={[styles.shell, containerStyle]}>
        <Text accessible={false} numberOfLines={1} ellipsizeMode="tail" style={style}>{text}</Text>
      </View>
    );
  }

  const resolvedTextStyle = StyleSheet.flatten([style, productFontStyle(style)]) ?? {};
  const fontSize = typeof resolvedTextStyle.fontSize === "number" ? resolvedTextStyle.fontSize : 14;
  const color = resolvedTextStyle.color;

  return (
    <View testID={testID} accessible accessibilityRole="text" accessibilityLabel={text} style={[styles.shell, containerStyle]}>
      <Text accessible={false} importantForAccessibility="no-hide-descendants" numberOfLines={1} ellipsizeMode="tail" style={[style, styles.measure]}>{text}</Text>
      <NativeShimmerText
        text={text}
        {...(color === undefined ? {} : { color })}
        fontSize={fontSize}
        {...(typeof resolvedTextStyle.fontFamily === "string" ? { fontFamily: resolvedTextStyle.fontFamily } : {})}
        {...(resolvedTextStyle.fontWeight === undefined ? {} : { fontWeight: String(resolvedTextStyle.fontWeight) })}
        {...(resolvedTextStyle.textAlign === undefined ? {} : { textAlign: resolvedTextStyle.textAlign })}
        animate
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { minWidth: 0, maxWidth: "100%", flexShrink: 1, alignSelf: "center", justifyContent: "center", overflow: "hidden" },
  measure: { opacity: 0 },
});
