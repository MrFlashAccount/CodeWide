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
  children?: ReactNode;
  delayMs: number;
  pointerEvents?: "auto" | "none" | "box-none" | "box-only";
  ready: boolean;
  reduceMotion: boolean;
  revealKey: string;
  style?: StyleProp<ViewStyle>;
};

const AndroidRevealSurface =
  // WHY: OTA JavaScript can run on an older native shell where the typed view manager is absent at runtime.
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  Platform.OS === "android" && UIManager.getViewManagerConfig("CodexRevealSurface") !== null
    ? requireNativeComponent<NativeRevealProps>("CodexRevealSurface")
    : null;

/** Reveals native content after readiness while preserving reduced-motion policy. */
export function NativeRevealSurface({
  animate = true,
  children,
  delayMs = 0,
  ready = true,
  revealKey,
  style,
}: {
  animate?: boolean;
  children: ReactNode;
  delayMs?: number;
  ready?: boolean;
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
      delayMs={Math.max(0, Math.min(120, delayMs))}
      pointerEvents="box-none"
      ready={ready}
      reduceMotion={false}
      revealKey={`${streamKey ?? "static"}:${revealKey}`}
      style={[styles.surface, style]}
    >
      {children}
    </AndroidRevealSurface>
  );
}

const styles = StyleSheet.create({
  surface: {
    maxWidth: "100%",
    minWidth: 0,
  },
});
