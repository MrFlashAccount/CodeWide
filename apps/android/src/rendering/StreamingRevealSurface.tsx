import type { ReactNode } from "react";
import { Platform, requireNativeComponent, UIManager, View, type ViewProps } from "react-native";

import { useReducedMotionPreference } from "./reduced-motion-store";
import { StreamingRevealContext } from "./streaming-reveal-context";

interface StreamingRevealProps extends ViewProps {
  streamKey: string;
  reduceMotion: boolean;
  animateNew: boolean;
}

// An older APK may receive this JS bundle before it has the native paint adapter.
const NativeSurface =
  Platform.OS === "android" && UIManager.getViewManagerConfig("CodeWideStreamingReveal") != null
    ? requireNativeComponent<StreamingRevealProps>("CodeWideStreamingReveal")
    : null;

/** Animation changes native glyph paint, never the published Markdown or its layout. */
export function StreamingRevealSurface({
  children,
  streamKey,
  animateNew = true,
}: {
  children: ReactNode;
  streamKey: string;
  animateNew?: boolean;
}) {
  const reduceMotion = useReducedMotionPreference();
  const shouldAnimate = NativeSurface !== null && animateNew && !reduceMotion;
  return (
    <StreamingRevealContext.Provider value={streamKey}>
      {!shouldAnimate ? (
        <View testID="streaming-reveal-fallback" pointerEvents="box-none">{children}</View>
      ) : (
        <NativeSurface streamKey={streamKey} reduceMotion={false} animateNew pointerEvents="box-none">
          {children}
        </NativeSurface>
      )}
    </StreamingRevealContext.Provider>
  );
}
