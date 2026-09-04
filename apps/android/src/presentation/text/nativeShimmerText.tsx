import {
  Platform,
  requireNativeComponent,
  type ColorValue,
  type StyleProp,
  type ViewStyle,
} from "react-native";

interface NativeShimmerTextProps {
  animate: boolean;
  color?: ColorValue;
  fontFamily?: string;
  fontSize: number;
  fontWeight?: string;
  lineHeight: number;
  numberOfLines: number;
  pointerEvents?: "auto" | "box-none" | "box-only" | "none";
  style: StyleProp<ViewStyle>;
  text: string;
  textAlign?: "auto" | "center" | "justify" | "left" | "right";
}

export const NativeShimmerText =
  Platform.OS === "android"
    ? requireNativeComponent<NativeShimmerTextProps>("CodexShimmerText")
    : null;
