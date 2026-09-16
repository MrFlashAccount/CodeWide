import { StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

import { usePerformanceExperiment } from "../data/performance-experiments";
import { NativeShimmerText } from "../presentation/text/nativeShimmerText";
import { useReducedMotionPreference } from "../rendering/reduced-motion-store";
import { AppText as Text, productFontStyle } from "./Typography";

interface WaveTextProps {
  containerStyle?: StyleProp<ViewStyle>;
  numberOfLines?: number;
  style: StyleProp<TextStyle>;
  testID?: string;
  text: string;
}

export function WaveText(props: WaveTextProps) {
  const { containerStyle, numberOfLines = 1, style, testID = "active-text-shimmer", text } = props;
  const reducedMotion = useReducedMotionPreference();
  const textShimmerDisabled = usePerformanceExperiment("disableTextShimmer");
  const animated = !reducedMotion && !textShimmerDisabled;
  if (!animated || NativeShimmerText === null) {
    return (
      <View
        accessibilityLabel={text}
        accessibilityRole="text"
        accessible
        style={[styles.shell, containerStyle]}
        testID={testID}
      >
        <Text
          accessible={false}
          ellipsizeMode="tail"
          numberOfLines={numberOfLines}
          style={[style, styles.textGeometry]}
        >
          {text}
        </Text>
      </View>
    );
  }

  const resolvedTextStyle = StyleSheet.flatten([style, productFontStyle(style)]);
  const fontSize = typeof resolvedTextStyle.fontSize === "number" ? resolvedTextStyle.fontSize : 14;
  const lineHeight =
    typeof resolvedTextStyle.lineHeight === "number"
      ? resolvedTextStyle.lineHeight
      : fontSize * 1.2;
  const color = resolvedTextStyle.color;

  return (
    <View
      accessibilityLabel={text}
      accessibilityRole="text"
      accessible
      style={[styles.shell, containerStyle]}
      testID={testID}
    >
      <Text
        accessible={false}
        ellipsizeMode="tail"
        importantForAccessibility="no-hide-descendants"
        numberOfLines={numberOfLines}
        style={[style, styles.textGeometry, styles.measure]}
      >
        {text}
      </Text>
      <NativeShimmerText
        text={text}
        {...(color === undefined ? {} : { color })}
        fontSize={fontSize}
        lineHeight={lineHeight}
        numberOfLines={numberOfLines}
        {...(typeof resolvedTextStyle.fontFamily === "string"
          ? { fontFamily: resolvedTextStyle.fontFamily }
          : {})}
        {...(resolvedTextStyle.fontWeight === undefined
          ? {}
          : { fontWeight: String(resolvedTextStyle.fontWeight) })}
        {...(resolvedTextStyle.textAlign === undefined
          ? {}
          : { textAlign: resolvedTextStyle.textAlign })}
        animate
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    alignSelf: "center",
    flexShrink: 1,
    justifyContent: "center",
    maxWidth: "100%",
    minWidth: 0,
    overflow: "hidden",
  },
  // NativeShimmerText uses StaticLayout.setIncludePad(false). Its Yoga measure
  // and reduced-motion fallback must not reserve Android's extra font padding.
  measure: { opacity: 0 },
  textGeometry: { includeFontPadding: false },
});
