import { useLayoutEffect, useRef, type ComponentPropsWithRef } from "react";
import { StyleSheet, Text as NativeText, type StyleProp, type TextStyle } from "react-native";

import { productFonts } from "./product-fonts";
import { APP_MAX_FONT_SIZE_MULTIPLIER } from "./typography-policy";
import { TextShimmer } from "./TextShimmer";

/** Ordinary native text props plus an optional geometry-neutral decoration. */
export type AppTextProps = ComponentPropsWithRef<typeof NativeText> & {
  /** Animate over the existing text; never replace its native view or change its styles. */
  shimmering?: boolean;
};

export function productFontStyle(style: StyleProp<TextStyle>): TextStyle | null {
  const flattened = StyleSheet.flatten([emptyTextStyle, style]);
  if (flattened.fontFamily !== undefined) {
    return null;
  }
  const rawWeight = flattened.fontWeight;
  const weight = rawWeight === "bold" ? 700 : Number.parseInt(String(rawWeight ?? 400), 10);
  const fontFamily =
    weight <= 400
      ? productFonts.regular
      : weight <= 500
        ? productFonts.medium
        : productFonts.semibold;

  return { fontFamily, fontWeight: "400" };
}

const emptyTextStyle: TextStyle = {};

export function AppText({
  allowFontScaling = true,
  children,
  maxFontSizeMultiplier = APP_MAX_FONT_SIZE_MULTIPLIER,
  ref,
  shimmering,
  style,
  ...props
}: AppTextProps): React.JSX.Element {
  const target = useRef<NativeText | null>(null);
  useLayoutEffect(() => {
    if (typeof ref === "function") {
      const cleanup = ref(target.current);
      return typeof cleanup === "function"
        ? cleanup
        : () => {
            ref(null);
          };
    }
    if (ref !== undefined && ref !== null) {
      ref.current = target.current;
      return () => {
        ref.current = null;
      };
    }
    return undefined;
  }, [ref]);
  return (
    <>
      <NativeText
        {...props}
        allowFontScaling={allowFontScaling}
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        ref={target}
        style={[style, productFontStyle(style)]}
      >
        {children}
      </NativeText>
      {shimmering === true && <TextShimmer shimmering target={target} />}
    </>
  );
}
