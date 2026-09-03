import { forwardRef, type ComponentProps } from "react";
import {
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  type StyleProp,
  type TextStyle,
} from "react-native";

import { productFonts } from "../../ui/productFonts";
import { APP_MAX_FONT_SIZE_MULTIPLIER } from "../../ui/typographyPolicy";
import { typeScale, typeWeight } from "../../theme";
import { useProductTextScale } from "./TextScaleContext";

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
  const readerScale = useProductTextScale();
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
      style={[style, readerTextScaleStyle(style, readerScale), presentationFontStyle(style)]}
    />
  );
}

function readerTextScaleStyle(style: StyleProp<TextStyle>, scale: number): TextStyle | null {
  if (scale === 1) return null;
  const flattened = StyleSheet.flatten(style);
  return {
    ...(flattened?.fontSize === undefined ? {} : { fontSize: flattened.fontSize * scale }),
    ...(flattened?.lineHeight === undefined ? {} : { lineHeight: flattened.lineHeight * scale }),
  };
}

export const PresentationTextInput = forwardRef<
  NativeTextInput,
  ComponentProps<typeof NativeTextInput>
>(function PresentationTextInput(inputProps, forwardedRef): React.JSX.Element {
  const {
    allowFontScaling = true,
    maxFontSizeMultiplier = APP_MAX_FONT_SIZE_MULTIPLIER,
    style,
    ...props
  } = inputProps;
  return (
    <NativeTextInput
      ref={forwardedRef}
      {...props}
      allowFontScaling={allowFontScaling}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[style, presentationFontStyle(style)]}
    />
  );
});

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
  return { fontFamily, fontWeight: typeWeight.regular };
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
  medium: { fontWeight: typeWeight.medium },
  regular: { fontWeight: typeWeight.regular },
  semibold: { fontWeight: typeWeight.semibold },
});

const styles = StyleSheet.create({
  base: { ...typeScale.body },
});
