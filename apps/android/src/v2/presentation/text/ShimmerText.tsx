import { StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

import { NativeShimmerText } from "../../../presentation/text/nativeShimmerText";
import { productFonts } from "../../ui/productFonts";
import { PresentationText } from "./ProductText";

interface ShimmerTextProps {
  containerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<TextStyle>;
  testID?: string;
  text: string;
  widthPolicy?: "bounded" | "intrinsic";
}

export function ShimmerText(props: ShimmerTextProps): React.JSX.Element {
  const {
    containerStyle,
    style,
    testID = "v2-progress-shimmer",
    text,
    widthPolicy = "bounded",
  } = props;
  const resolved = StyleSheet.flatten(style) ?? {};
  const fontSize = typeof resolved.fontSize === "number" ? resolved.fontSize : 13;
  const lineHeight = typeof resolved.lineHeight === "number" ? resolved.lineHeight : fontSize * 1.2;
  const color = resolved.color;
  const fontFamily = resolved.fontFamily ?? productFontFamily(resolved.fontWeight);
  const fontWeight = resolved.fontFamily === undefined ? "400" : resolved.fontWeight;
  const widthStyle = widthPolicy === "intrinsic" ? styles.intrinsicWidth : styles.boundedWidth;
  if (NativeShimmerText === null) {
    return (
      <View
        accessibilityLabel={text}
        accessibilityLiveRegion="polite"
        accessibilityRole="text"
        accessible
        style={[styles.shell, widthStyle, containerStyle]}
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
      style={[styles.shell, widthStyle, containerStyle]}
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
        lineHeight={lineHeight}
        numberOfLines={1}
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
  boundedWidth: { flexShrink: 1, maxWidth: "100%", minWidth: 0, overflow: "hidden" },
  intrinsicWidth: { flexGrow: 0, flexShrink: 0 },
  measure: { opacity: 0 },
  shell: {
    alignSelf: "center",
    justifyContent: "center",
  },
});
