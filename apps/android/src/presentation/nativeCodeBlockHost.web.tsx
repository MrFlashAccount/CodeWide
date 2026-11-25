import type { HostComponent, StyleProp, ViewStyle } from "react-native";

export interface NativeCodeBlockHostProps {
  code: string;
  embeddedInParentScroll?: boolean;
  language: string;
  maxLines: number;
  searchQuery?: string;
  style: StyleProp<ViewStyle>;
  variant: "code" | "diff" | "terminal";
  wrapLines?: boolean;
}

/** Web uses the caller-owned scrollable text fallback. */
export const NativeCodeBlockHost: HostComponent<NativeCodeBlockHostProps> | null = null;
