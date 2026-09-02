import {
  Platform,
  requireNativeComponent,
  StyleSheet,
  View,
  type ColorValue,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { productFonts } from "../../ui/productFonts";
import { PresentationText } from "./ProductText";

interface NativeShimmerTextProps {
  animate: boolean;
  color?: ColorValue;
  fontFamily?: string;
  fontSize: number;
  fontWeight?: string;
  pointerEvents?: "auto" | "box-none" | "box-only" | "none";
  style: StyleProp<ViewStyle>;
  text: string;
  textAlign?: "auto" | "center" | "justify" | "left" | "right";
}

interface ShimmerTextProps {
  containerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<TextStyle>;
  testID?: string;
  text: string;
}

const NativeShimmerText =
  Platform.OS === "android"
    ? requireNativeComponent<NativeShimmerTextProps>("CodexShimmerText")
    : null;

export function ShimmerText(props: ShimmerTextProps): React.JSX.Element {
  const { containerStyle, style, testID = "v2-progress-shimmer", text } = props;
  const resolved = StyleSheet.flatten(style) ?? {};
  const fontSize = typeof resolved.fontSize === "number" ? resolved.fontSize : 13;
  const color = resolved.color;
  const fontFamily = resolved.fontFamily ?? productFontFamily(resolved.fontWeight);
  const fontWeight = resolved.fontFamily === undefined ? "400" : resolved.fontWeight;
  if (NativeShimmerText === null) {
    return (
      <View
        accessibilityLabel={text}
        accessibilityLiveRegion="polite"
        accessibilityRole="text"
        accessible
        style={[styles.shell, containerStyle]}
        testID={testID}
      >
        <PresentationText ellipsizeMode="tail" numberOfLines={1} style={style}>
          {text}
        </PresentationText>
      </View>
    );
  }
  return (
    <View
      accessibilityLabel={text}
      accessibilityLiveRegion="polite"
      accessibilityRole="text"
      accessible
      style={[styles.shell, containerStyle]}
      testID={testID}
    >
      <PresentationText
        accessible={false}
        ellipsizeMode="tail"
        importantForAccessibility="no-hide-descendants"
        numberOfLines={1}
        style={[style, styles.measure]}
      >
        {text}
      </PresentationText>
      <NativeShimmerText
        animate
        {...(color === undefined ? {} : { color })}
        fontFamily={fontFamily}
        fontSize={fontSize}
        {...(fontWeight === undefined ? {} : { fontWeight: String(fontWeight) })}
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        text={text}
        {...(resolved.textAlign === undefined ? {} : { textAlign: resolved.textAlign })}
      />
    </View>
  );
}

function productFontFamily(weight: TextStyle["fontWeight"]): string {
  const numericWeight = weight === "bold" ? 700 : Number.parseInt(String(weight ?? 400), 10);
  if (numericWeight <= 400) return productFonts.regular;
  if (numericWeight <= 500) return productFonts.medium;
  return productFonts.semibold;
}

const styles = StyleSheet.create({
  measure: { opacity: 0 },
  shell: {
    alignSelf: "center",
    flexShrink: 1,
    justifyContent: "center",
    maxWidth: "100%",
    minWidth: 0,
    overflow: "hidden",
  },
});
