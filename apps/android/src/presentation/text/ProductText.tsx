import type { ComponentProps } from "react";
import { StyleSheet, Text, type TextStyle } from "react-native";

type ProductTextTone = "default" | "dim" | "muted" | "danger" | "success" | "warning";
type ProductTextWeight = "medium" | "regular" | "semibold";

export function ProductText({
  style,
  tone = "default",
  weight = "regular",
  ...props
}: ComponentProps<typeof Text> & {
  tone?: ProductTextTone;
  weight?: ProductTextWeight;
}): React.JSX.Element {
  return <Text {...props} style={[styles.base, tones[tone], weights[weight], style]} />;
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
  medium: { fontFamily: "RobotoFlex-Medium", fontWeight: "400" },
  regular: { fontFamily: "RobotoFlex-Regular", fontWeight: "400" },
  semibold: { fontFamily: "RobotoFlex-SemiBold", fontWeight: "400" },
});

const styles = StyleSheet.create({
  base: { fontSize: 14, lineHeight: 20 },
});
