import type { ComponentProps } from "react";
import { StyleSheet, Text as NativeText, type StyleProp, type TextStyle } from "react-native";

import { productFonts } from "./product-fonts";
import { APP_MAX_FONT_SIZE_MULTIPLIER } from "./typography-policy";

export function productFontStyle(style: StyleProp<TextStyle>): TextStyle | null {
  const flattened = StyleSheet.flatten(style);
  if (flattened?.fontFamily !== undefined) return null;

  const rawWeight = flattened?.fontWeight;
  const weight = rawWeight === "bold" ? 700 : Number.parseInt(String(rawWeight ?? 400), 10);
  const fontFamily =
    weight <= 400
      ? productFonts.regular
      : weight <= 500
        ? productFonts.medium
        : productFonts.semibold;

  return { fontFamily, fontWeight: "400" };
}

export function AppText({
  style,
  allowFontScaling = true,
  maxFontSizeMultiplier = APP_MAX_FONT_SIZE_MULTIPLIER,
  ...props
}: ComponentProps<typeof NativeText>) {
  return (
    <NativeText
      {...props}
      allowFontScaling={allowFontScaling}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[style, productFontStyle(style)]}
    />
  );
}
