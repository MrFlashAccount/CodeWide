import type { CustomRendererProps, TBlock, TPhrasing, TText } from "@native-html/render";
import { StyleSheet, Text, View } from "react-native";

import { colors, radii, spacing, typeScale } from "../theme";
import { percentageDimension } from "../ui/percentageDimension";
import { productFonts } from "../ui/product-fonts";

type ControlProps = CustomRendererProps<TBlock | TPhrasing | TText>;

/** Form snippets are readable examples, not executable controls or credential inputs. */
export function MarkupInput(props: ControlProps) {
  const attributes = props.tnode.attributes;
  if (attributes.type === "hidden") {
    return null;
  }
  const checkable = attributes.type === "checkbox" || attributes.type === "radio";
  const value = checkable
    ? Object.hasOwn(attributes, "checked")
      ? "☑"
      : "☐"
    : attributes.type === "password"
      ? "••••"
      : (attributes.value ?? attributes.placeholder ?? "");
  return <Text style={styles.text}>{value}</Text>;
}

export function MarkupProgress(props: ControlProps) {
  const attributes = props.tnode.attributes;
  const min = finite(attributes.min, 0);
  const max = finite(attributes.max, 1);
  const value = finite(attributes.value, min);
  const fraction = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ max: 100, min: 0, now: Math.round(fraction * 100) }}
      accessible
      style={styles.progress}
    >
      <View style={[styles.fill, { width: percentageDimension(fraction * 100) }]} />
    </View>
  );
}

function finite(value: string | undefined, fallback: number): number {
  const number = Number(value);
  return value !== undefined && Number.isFinite(number) ? number : fallback;
}

const styles = StyleSheet.create({
  fill: {
    backgroundColor: colors.primary,
    height: "100%",
  },
  progress: {
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.pill,
    height: spacing.xs,
    overflow: "hidden",
  },
  text: {
    color: colors.text,
    fontFamily: productFonts.regular,
    ...typeScale.body,
  },
});
