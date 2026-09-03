import {
  Platform,
  requireNativeComponent,
  type HostComponent,
  type StyleProp,
  type ViewStyle,
} from "react-native";

export interface NativeCodeBlockHostProps {
  code: string;
  language: string;
  maxLines: number;
  style: StyleProp<ViewStyle>;
  variant: "code" | "diff" | "terminal";
}

export const NativeCodeBlockHost: HostComponent<NativeCodeBlockHostProps> | null =
  Platform.OS === "android"
    ? requireNativeComponent<NativeCodeBlockHostProps>("CodexNativeCodeBlock")
    : null;
