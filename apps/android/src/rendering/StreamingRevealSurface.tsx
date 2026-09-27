import type { ReactNode } from "react";
import { Platform, requireNativeComponent, UIManager, View, type ViewProps } from "react-native";

import { useReducedMotionPreference } from "./reduced-motion-store";
import { StreamingRevealContext } from "./streaming-reveal-context";

interface StreamingRevealProps extends ViewProps {
  animateNew: boolean;
  reduceMotion: boolean;
  streamKey: string;
}

// An older APK may receive this JS bundle before it has the native paint adapter.
const NativeSurface =
  // WHY: OTA JavaScript can run on an older native shell where the typed view manager is absent at runtime.
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  Platform.OS === "android" && UIManager.getViewManagerConfig("CodeWideStreamingReveal") !== null
    ? requireNativeComponent<StreamingRevealProps>("CodeWideStreamingReveal")
    : null;

/** Animation changes native glyph paint; toggling it must retain the mounted text and layout. */
export function StreamingRevealSurface({
  animateNew = true,
  children,
  streamKey,
}: {
  animateNew?: boolean;
  children: ReactNode;
  streamKey: string;
}) {
  const reduceMotion = useReducedMotionPreference();
  return (
    <StreamingRevealContext.Provider value={animateNew && !reduceMotion ? streamKey : null}>
      {NativeSurface === null ? (
        <View pointerEvents="box-none" testID="streaming-reveal-fallback">
          {children}
        </View>
      ) : (
        <NativeSurface
          animateNew={animateNew}
          pointerEvents="box-none"
          reduceMotion={reduceMotion}
          streamKey={streamKey}
        >
          {children}
        </NativeSurface>
      )}
    </StreamingRevealContext.Provider>
  );
}
