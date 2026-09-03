import { Ionicons } from "@expo/vector-icons";
import { useState, useTransition } from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  View,
  type ImageLoadEventData,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";

import { useEvent } from "../../../react/useEvent";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";
import { ProductText as Text } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";
import { containImageSize, type ImagePreviewSize } from "./imagePreviewGestureModel";
import { useImagePreviewGestures } from "./useImagePreviewGestures";

interface InteractiveImageSource {
  headers?: Record<string, string>;
  uri: string;
}

interface InteractiveImageViewProps {
  accessibilityLabel: string;
  canGoNext: boolean;
  canGoPrevious: boolean;
  onClose?(): void;
  onNext(): void;
  onPrevious(): void;
  onRetry?(): void | Promise<void>;
  source: InteractiveImageSource;
}

/** Renders the shared V2 pan, swipe, dismiss, pinch, and double-tap image surface. */
export function InteractiveImageView(props: InteractiveImageViewProps): React.JSX.Element {
  const {
    accessibilityLabel,
    canGoNext,
    canGoPrevious,
    onClose,
    onNext,
    onPrevious,
    onRetry,
    source,
  } = props;
  const [viewport, setViewport] = useState<ImagePreviewSize>({ height: 1, width: 1 });
  const [intrinsic, setIntrinsic] = useState<ImagePreviewSize>({ height: 1, width: 1 });
  const [decodeState, setDecodeState] = useState<"error" | "loading" | "ready">("loading");
  const [loadRevision, setLoadRevision] = useState(0);
  const [retrying, startRetry] = useTransition();
  const fitted = containImageSize(intrinsic, viewport);
  const gestures = useImagePreviewGestures({
    canGoNext,
    canGoPrevious,
    fitted,
    onNext,
    onPrevious,
    viewport,
    ...(onClose === undefined ? {} : { onClose }),
  });
  const retry = useEvent(() => {
    if (retrying || onRetry === undefined) return;
    startRetry(async () => {
      setDecodeState("loading");
      try {
        await onRetry();
        setLoadRevision((current) => current + 1);
      } catch {
        setDecodeState("error");
      }
    });
  });
  const updateViewport = useEvent((event: LayoutChangeEvent): void => {
    setViewport({
      height: Math.max(1, event.nativeEvent.layout.height),
      width: Math.max(1, event.nativeEvent.layout.width),
    });
  });
  const failedToLoad = useEvent((): void => setDecodeState("error"));
  const loaded = useEvent((event: NativeSyntheticEvent<ImageLoadEventData>): void => {
    setDecodeState("ready");
    const loadedSource = event.nativeEvent.source;
    if (loadedSource === undefined) return;
    if (loadedSource.width > 0 && loadedSource.height > 0) {
      setIntrinsic({ height: loadedSource.height, width: loadedSource.width });
    }
  });
  const startedLoading = useEvent((): void => setDecodeState("loading"));
  return (
    <Animated.View onLayout={updateViewport} style={[styles.viewer, gestures.backdropStyle]}>
      <GestureDetector gesture={gestures.gesture}>
        <View style={styles.gestureSurface}>
          {decodeState === "loading" ? (
            <View accessibilityLabel="Loading image" pointerEvents="none" style={styles.status}>
              <ShimmerText text="Loading image…" />
            </View>
          ) : null}
          {decodeState === "error" ? (
            <View accessibilityLiveRegion="polite" style={styles.status}>
              <Ionicons color={colors.text} name="image-outline" size={28} />
              <Text style={styles.error}>Could not load this image.</Text>
              {onRetry === undefined ? null : (
                <Pressable
                  accessibilityLabel="Retry image preview"
                  accessibilityRole="button"
                  accessibilityState={{ busy: retrying, disabled: retrying }}
                  disabled={retrying}
                  onPress={retry}
                  style={styles.retry}
                >
                  {retrying ? (
                    <ShimmerText text="Retrying…" />
                  ) : (
                    <Text style={styles.retryText}>Retry</Text>
                  )}
                </Pressable>
              )}
            </View>
          ) : null}
          <Animated.View
            style={[
              styles.imageLayer,
              { height: fitted.height, width: fitted.width },
              gestures.imageStyle,
            ]}
          >
            <Image
              key={loadRevision}
              accessibilityLabel={accessibilityLabel}
              onError={failedToLoad}
              onLoad={loaded}
              onLoadStart={startedLoading}
              resizeMethod="none"
              resizeMode="contain"
              source={source}
              style={styles.image}
            />
          </Animated.View>
        </View>
      </GestureDetector>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.text, ...typeScale.body, textAlign: "center" },
  gestureSurface: { alignItems: "center", flex: 1, justifyContent: "center", overflow: "hidden" },
  image: { height: "100%", width: "100%" },
  imageLayer: { alignItems: "center", justifyContent: "center" },
  retry: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.pill,
    justifyContent: "center",
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
  },
  retryText: { color: colors.text, ...typeScale.label },
  status: {
    alignItems: "center",
    gap: spacing.sm,
    justifyContent: "center",
    position: "absolute",
    zIndex: 2,
  },
  viewer: { backgroundColor: "#000000", flex: 1 },
});
