import {
  Platform,
  requireNativeComponent,
  type HostComponent,
  type StyleProp,
  type ViewStyle,
} from "react-native";

export interface NativeCodeBlockHostProps {
  code: string;
  embeddedInParentScroll?: boolean;
  language: string;
  maxLines: number;
  searchQuery?: string;
  style: StyleProp<ViewStyle>;
  variant: "code" | "diff" | "terminal";
}

/** Android code renderer; unsupported platforms use their caller-owned fallback. */
export const NativeCodeBlockHost: HostComponent<NativeCodeBlockHostProps> | null =
  Platform.OS === "android"
    ? requireNativeComponent<NativeCodeBlockHostProps>("CodexNativeCodeBlock")
    : null;
