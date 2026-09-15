import type { ReactNode } from "react";
import {
  Platform,
  requireNativeComponent,
  StyleSheet,
  UIManager,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { useReducedMotionPreference } from "./reduced-motion-store";
import { useStreamingRevealKey } from "./streaming-reveal-context";

type NativeRevealProps = {
  ready: boolean;
  reduceMotion: boolean;
  revealKey: string;
  delayMs: number;
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

const AndroidRevealSurface =
  Platform.OS === "android" && UIManager.getViewManagerConfig("CodexRevealSurface") != null
    ? requireNativeComponent<NativeRevealProps>("CodexRevealSurface")
    : null;

/** Reveals native content after readiness while preserving reduced-motion policy. */
export function NativeRevealSurface({
  children,
  ready = true,
  animate = true,
  delayMs = 0,
  revealKey,
  style,
}: {
  children: ReactNode;
  ready?: boolean;
  animate?: boolean;
  delayMs?: number;
  revealKey: string;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReducedMotionPreference();
  const streamKey = useStreamingRevealKey();
  if (AndroidRevealSurface === null || !animate || reduceMotion) {
    return (
      <View pointerEvents="box-none" style={style}>
        {children}
      </View>
    );
  }
  return (
    <AndroidRevealSurface
      ready={ready}
      reduceMotion={false}
      revealKey={`${streamKey ?? "static"}:${revealKey}`}
      delayMs={Math.max(0, Math.min(120, delayMs))}
      pointerEvents="box-none"
      style={[styles.surface, style]}
    >
      {children}
    </AndroidRevealSurface>
  );
}

const styles = StyleSheet.create({
  surface: {
    minWidth: 0,
    maxWidth: "100%",
  },
});
