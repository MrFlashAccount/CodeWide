import type { ReactNode } from "react";
import {
  Platform,
  requireNativeComponent,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { useReducedMotionPreference } from "./reduced-motion-store";

type NativeRevealProps = {
  ready: boolean;
  reduceMotion: boolean;
  revealKey: string;
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

const AndroidRevealSurface = Platform.OS === "android"
  ? requireNativeComponent<NativeRevealProps>("CodexRevealSurface")
  : null;

export function NativeRevealSurface({
  children,
  ready = true,
  revealKey,
  style,
}: {
  children: ReactNode;
  ready?: boolean;
  revealKey: string;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReducedMotionPreference();
  if (AndroidRevealSurface === null) return <View style={style}>{children}</View>;
  return (
    <AndroidRevealSurface
      ready={ready}
      reduceMotion={reduceMotion}
      revealKey={revealKey}
      pointerEvents="box-none"
      style={[styles.surface, style]}
    >
      {children}
    </AndroidRevealSurface>
  );
}

const styles = StyleSheet.create({
  surface: { minWidth: 0, maxWidth: "100%" },
});
