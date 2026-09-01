import type { ComponentProps } from "react";
import {
  StyleSheet,
  Text as NativeText,
  type StyleProp,
  type TextStyle,
} from "react-native";

import { productFonts } from "../../ui/product-fonts";
import { APP_MAX_FONT_SIZE_MULTIPLIER } from "../../ui/typography-policy";
import { AppTextInput, type AppTextInputProps } from "../../ui/Typography";

type ProductTextTone = "default" | "dim" | "muted" | "danger" | "success" | "warning";
type ProductTextWeight = "medium" | "regular" | "semibold";

export function ProductText({
  style,
  tone = "default",
  weight = "regular",
  ...props
}: ComponentProps<typeof NativeText> & {
  tone?: ProductTextTone;
  weight?: ProductTextWeight;
}): React.JSX.Element {
  return <PresentationText {...props} style={[styles.base, tones[tone], weights[weight], style]} />;
}

export function PresentationText({
  allowFontScaling = true,
  maxFontSizeMultiplier = APP_MAX_FONT_SIZE_MULTIPLIER,
  style,
  ...props
}: ComponentProps<typeof NativeText>): React.JSX.Element {
  return (
    <NativeText
      {...props}
      allowFontScaling={allowFontScaling}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[style, presentationFontStyle(style)]}
    />
  );
}

export function PresentationTextInput({
  allowFontScaling = true,
  maxFontSizeMultiplier = APP_MAX_FONT_SIZE_MULTIPLIER,
  style,
  ...props
}: AppTextInputProps): React.JSX.Element {
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
  danger: { color: "#F05D65" },
  default: { color: "#F2F2F2" },
  dim: { color: "#858585" },
  muted: { color: "#B8B8B8" },
  success: { color: "#35C778" },
  warning: { color: "#E9872C" },
});

const weights = StyleSheet.create<Record<ProductTextWeight, TextStyle>>({
  medium: { fontWeight: "600" },
  regular: { fontWeight: "400" },
  semibold: { fontWeight: "700" },
});

const styles = StyleSheet.create({
  base: { fontSize: 14, lineHeight: 20 },
});
