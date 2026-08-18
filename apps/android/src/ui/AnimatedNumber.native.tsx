import {
  requireNativeComponent,
  StyleSheet,
  View,
  type ColorValue,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { formatNumber } from "./number-format";
import { AppText as Text, productFontStyle } from "./Typography";

export { compactNumberFormat, integerNumberFormat, usdNumberFormat } from "./number-format";

type NativeAnimatedNumberProps = {
  value: number;
  formatStyle: "decimal" | "compact" | "currency";
  currency?: string;
  minimumFractionDigits: number;
  maximumFractionDigits: number;
  prefix: string;
  suffix: string;
  color?: ColorValue;
  fontSize: number;
  lineHeight: number;
  fontFamily?: string;
  fontWeight?: string;
  textAlign?: "auto" | "left" | "right" | "center" | "justify";
  animate: boolean;
  numberAccessibilityLabel?: string;
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  style: StyleProp<ViewStyle>;
};

const NativeAnimatedNumber = requireNativeComponent<NativeAnimatedNumberProps>("CodexAnimatedNumber");

export function AnimatedNumber({
  value,
  format,
  prefix = "",
  suffix = "",
  style,
  containerStyle,
  accessibilityLabel,
  testID,
  animate = true,
}: {
  value: number;
  format?: Intl.NumberFormatOptions;
  prefix?: string;
  suffix?: string;
  style?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  testID?: string;
  animate?: boolean;
}) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const resolvedTextStyle = StyleSheet.flatten([style, productFontStyle(style)]) ?? {};
  const renderedText = `${prefix}${formatNumber(safeValue, format)}${suffix}`;
  const fontSize = typeof resolvedTextStyle.fontSize === "number" ? resolvedTextStyle.fontSize : 14;
  const lineHeight = typeof resolvedTextStyle.lineHeight === "number" ? resolvedTextStyle.lineHeight : Math.ceil(fontSize * 1.25);
  const color = resolvedTextStyle.color;
  const formatStyle = format?.style === "currency" ? "currency" : format?.notation === "compact" ? "compact" : "decimal";
  const maximumFractionDigits = format?.maximumFractionDigits ?? (formatStyle === "currency" ? 2 : 3);
  const minimumFractionDigits = format?.minimumFractionDigits ?? (formatStyle === "currency" ? 2 : 0);

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? renderedText}
      testID={testID}
      style={[styles.container, containerStyle]}
    >
      <Text accessible={false} importantForAccessibility="no-hide-descendants" style={[style, styles.measure]}>{renderedText}</Text>
      <NativeAnimatedNumber
        value={safeValue}
        formatStyle={formatStyle}
        {...(format?.currency === undefined ? {} : { currency: format.currency })}
        minimumFractionDigits={minimumFractionDigits}
        maximumFractionDigits={maximumFractionDigits}
        prefix={prefix}
        suffix={suffix}
        {...(color === undefined ? {} : { color })}
        fontSize={fontSize}
        lineHeight={lineHeight}
        {...(typeof resolvedTextStyle.fontFamily === "string" ? { fontFamily: resolvedTextStyle.fontFamily } : {})}
        {...(resolvedTextStyle.fontWeight === undefined ? {} : { fontWeight: String(resolvedTextStyle.fontWeight) })}
        {...(resolvedTextStyle.textAlign === undefined ? {} : { textAlign: resolvedTextStyle.textAlign })}
        animate={animate}
        numberAccessibilityLabel={accessibilityLabel ?? renderedText}
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexShrink: 0, alignSelf: "flex-start", justifyContent: "center" },
  measure: { opacity: 0 },
});
