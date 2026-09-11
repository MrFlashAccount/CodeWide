import { colors, typeWeight, typeScale } from "../../theme";
import type { ComponentProps } from "react";
import { StyleSheet, Text as NativeText, type StyleProp, type TextStyle } from "react-native";

import { productFonts } from "../../ui/product-fonts";
import { APP_MAX_FONT_SIZE_MULTIPLIER } from "../../ui/typography-policy";
import { AppTextInput, type AppTextInputProps } from "../../ui/Typography";

type ProductTextTone = "default" | "dim" | "muted" | "danger" | "success" | "warning";
type ProductTextWeight = "medium" | "regular" | "semibold";

export function ProductText(
  textProps: ComponentProps<typeof NativeText> & {
    tone?: ProductTextTone;
    weight?: ProductTextWeight;
  },
): React.JSX.Element {
  const { style, tone = "default", weight = "regular", ...props } = textProps;
  return <PresentationText {...props} style={[styles.base, tones[tone], weights[weight], style]} />;
}

export function PresentationText(textProps: ComponentProps<typeof NativeText>): React.JSX.Element {
  const {
    allowFontScaling = true,
    maxFontSizeMultiplier = APP_MAX_FONT_SIZE_MULTIPLIER,
    style,
    ...props
  } = textProps;
  return (
    <NativeText
      {...props}
      allowFontScaling={allowFontScaling}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[style, presentationFontStyle(style)]}
    />
  );
}

export function PresentationTextInput(inputProps: AppTextInputProps): React.JSX.Element {
  const {
    allowFontScaling = true,
    maxFontSizeMultiplier = APP_MAX_FONT_SIZE_MULTIPLIER,
    style,
    ...props
  } = inputProps;
  return (
    <AppTextInput
      {...props}
      allowFontScaling={allowFontScaling}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[style, presentationFontStyle(style)]}
    />
  );
}

function presentationFontStyle(style: StyleProp<TextStyle>): TextStyle | null {
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

const tones = StyleSheet.create<Record<ProductTextTone, TextStyle>>({
  danger: { color: colors.red },
  default: { color: colors.text },
  dim: { color: colors.textDim },
  muted: { color: colors.textMuted },
  success: { color: colors.green },
  warning: { color: colors.amber },
});

const weights = StyleSheet.create<Record<ProductTextWeight, TextStyle>>({
  medium: { fontWeight: typeWeight.medium },
  regular: { fontWeight: typeWeight.regular },
  semibold: { fontWeight: typeWeight.semibold },
});

const styles = StyleSheet.create({
  base: { ...typeScale.body },
});
