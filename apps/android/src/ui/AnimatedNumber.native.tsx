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
import { APP_MAX_FONT_SIZE_MULTIPLIER } from "./typography-policy";

export { compactNumberFormat, integerNumberFormat, usdNumberFormat } from "./number-format";

type NativeAnimatedNumberProps = {
  animate: boolean;
  color?: ColorValue;
  currency?: string;
  fontFamily?: string;
  fontSize: number;
  fontWeight?: string;
  formatStyle: "decimal" | "compact" | "currency";
  lineHeight: number;
  maxFontSizeMultiplier: number;
  maximumFractionDigits: number;
  minimumFractionDigits: number;
  numberAccessibilityLabel?: string;
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  prefix: string;
  style: StyleProp<ViewStyle>;
  suffix: string;
  textAlign?: "auto" | "left" | "right" | "center" | "justify";
  value: number;
};

const NativeAnimatedNumber =
  requireNativeComponent<NativeAnimatedNumberProps>("CodexAnimatedNumber");

export function AnimatedNumber({
  accessibilityLabel,
  animate = true,
  containerStyle,
  format,
  prefix = "",
  style,
  suffix = "",
  testID,
  value,
}: {
  accessibilityLabel?: string;
  animate?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  format?: Intl.NumberFormatOptions;
  prefix?: string;
  style?: StyleProp<TextStyle>;
  suffix?: string;
  testID?: string;
  value: number;
}) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const resolvedTextStyle = StyleSheet.flatten([style, productFontStyle(style)]);
  const renderedText = `${prefix}${formatNumber(safeValue, format)}${suffix}`;
  const fontSize = typeof resolvedTextStyle.fontSize === "number" ? resolvedTextStyle.fontSize : 14;
  const lineHeight =
    typeof resolvedTextStyle.lineHeight === "number"
      ? resolvedTextStyle.lineHeight
      : Math.ceil(fontSize * 1.25);
  const color = resolvedTextStyle.color;
  const formatStyle =
    format?.style === "currency"
      ? "currency"
      : format?.notation === "compact"
        ? "compact"
        : "decimal";
  const maximumFractionDigits =
    format?.maximumFractionDigits ?? (formatStyle === "currency" ? 2 : 3);
  const minimumFractionDigits =
    format?.minimumFractionDigits ?? (formatStyle === "currency" ? 2 : 0);

  return (
    <View
      accessibilityLabel={accessibilityLabel ?? renderedText}
      accessibilityRole="text"
      accessible
      style={[styles.container, containerStyle]}
      testID={testID}
    >
      <Text
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        style={[style, styles.measure]}
      >
        {renderedText}
      </Text>
      <NativeAnimatedNumber
        formatStyle={formatStyle}
        value={safeValue}
        {...(format?.currency === undefined ? {} : { currency: format.currency })}
        maximumFractionDigits={maximumFractionDigits}
        minimumFractionDigits={minimumFractionDigits}
        prefix={prefix}
        suffix={suffix}
        {...(color === undefined ? {} : { color })}
        fontSize={fontSize}
        lineHeight={lineHeight}
        maxFontSizeMultiplier={APP_MAX_FONT_SIZE_MULTIPLIER}
        {...(typeof resolvedTextStyle.fontFamily === "string"
          ? { fontFamily: resolvedTextStyle.fontFamily }
          : {})}
        {...(resolvedTextStyle.fontWeight === undefined
          ? {}
          : { fontWeight: String(resolvedTextStyle.fontWeight) })}
        {...(resolvedTextStyle.textAlign === undefined
          ? {}
          : { textAlign: resolvedTextStyle.textAlign })}
        animate={animate}
        numberAccessibilityLabel={accessibilityLabel ?? renderedText}
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignSelf: "flex-start",
    flexShrink: 0,
    justifyContent: "center",
  },
  measure: {
    fontVariant: ["tabular-nums"],
    opacity: 0,
  },
});
