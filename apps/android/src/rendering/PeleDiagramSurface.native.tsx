import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState, type ReactElement } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { SvgXml } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";

import { useEvent } from "../react/useEvent";
import { colors, iconSize, radii, spacing, typeScale, typeWeight } from "../theme";
import { AppText } from "../ui/Typography";
import { useAsyncResource, type AsyncResourceSnapshot } from "./async-resource-store";
import type { ContentReviewPoint } from "./ContentReviewHost";
import { DiagramPreviewVisibility } from "./DiagramPreviewViewport";
import { InlineMediaFrame } from "./InlineMediaFrame";
import { peleDiagramKey, renderPeleDiagram } from "./peleDiagramWorker.native";
import type { PeleDiagramRenderResult } from "./peleDiagramRenderer";

interface PeleDiagramPreviewProps {
  readonly onOpen: () => void;
  readonly onSettled: () => void;
  readonly source: string;
}

interface Size {
  readonly height: number;
  readonly width: number;
}

interface DiagramTransform {
  readonly scale: SharedValue<number>;
  readonly translateX: SharedValue<number>;
  readonly translateY: SharedValue<number>;
}

const ERROR_LINE_LIMIT = 5;
const HALF = 0.5;
const MAX_ZOOM = 5;
const MIN_PAN_DISTANCE = 4;
const PENDING_REVIEW_OPACITY = 0.65;
const REVIEW_POINT_SIZE = 24;
const STATUS_MAX_WIDTH = 520;
const STRING_BYTES_PER_CHAR = 2;
const ZOOM_ANIMATION_MS = 140;
const ZOOM_IN_FACTOR = 1.25;
const ZOOM_OUT_FACTOR = 0.8;

export type PeleDiagramZoomCommand = {
  readonly id: number;
  readonly kind: "in" | "out" | "reset";
};

export function PeleDiagramPreview(props: PeleDiagramPreviewProps): ReactElement {
  return (
    <DiagramPreviewVisibility>
      {(visibility) => <VisiblePeleDiagramPreview {...props} {...visibility} />}
    </DiagramPreviewVisibility>
  );
}

function VisiblePeleDiagramPreview({
  activated,
  near,
  onOpen,
  onSettled,
  source,
}: PeleDiagramPreviewProps & {
  readonly activated: boolean;
  readonly near: boolean;
}): ReactElement {
  const resource = usePeleDiagramResource(activated, source);
  const settled = useEvent(onSettled);
  useEffect(() => {
    if (resource.status === "ready" || resource.status === "error") {
      settled();
    }
  }, [resource.status, settled]);
  const result = resource.value;
  return (
    <InlineMediaFrame>
      <Pressable
        accessibilityLabel="Open diagram fullscreen"
        accessibilityRole="button"
        onPress={onOpen}
        style={styles.preview}
      >
        <PeleDiagramPreviewContent error={resource.error} near={near} result={result} />
      </Pressable>
    </InlineMediaFrame>
  );
}

function PeleDiagramPreviewContent({
  error,
  near,
  result,
}: {
  readonly error: string | null;
  readonly near: boolean;
  readonly result: PeleDiagramRenderResult | null;
}): ReactElement {
  const message = diagramError(error, result);
  if (message !== null) {
    return <DiagramStatus icon="warning-outline" message={message} role="alert" />;
  }
  if (!near || result?.status !== "ready") {
    return (
      <DiagramStatus
        icon="git-network-outline"
        message={near ? "Rendering diagram…" : "Diagram preview"}
      />
    );
  }
  return <SvgXml height="100%" preserveAspectRatio="xMidYMid meet" width="100%" xml={result.svg} />;
}

export function PeleDiagramFullscreenSurface({
  annotationEnabled,
  enabled,
  onReviewPoint,
  reviewPoints,
  source,
  zoomCommand,
}: {
  readonly annotationEnabled: boolean;
  readonly enabled: boolean;
  readonly onReviewPoint?: (x: number, y: number) => void;
  readonly reviewPoints: readonly ContentReviewPoint[];
  readonly source: string;
  readonly zoomCommand: PeleDiagramZoomCommand;
}): ReactElement {
  const resource = usePeleDiagramResource(enabled, source);
  const result = resource.value;
  const message = diagramError(resource.error, result);
  if (message !== null) {
    return (
      <View style={styles.fullscreenStatus}>
        <DiagramStatus icon="warning-outline" message={message} role="alert" />
      </View>
    );
  }
  if (result?.status !== "ready") {
    return (
      <View style={styles.fullscreenStatus}>
        <DiagramStatus icon="git-network-outline" message="Rendering diagram…" />
      </View>
    );
  }
  return (
    <ZoomablePeleDiagram
      annotationEnabled={annotationEnabled}
      height={result.height}
      reviewPoints={reviewPoints}
      svg={result.svg}
      width={result.width}
      zoomCommand={zoomCommand}
      {...(onReviewPoint === undefined ? {} : { onReviewPoint })}
    />
  );
}

function ZoomablePeleDiagram({
  annotationEnabled,
  height,
  onReviewPoint,
  reviewPoints,
  svg,
  width,
  zoomCommand,
}: {
  readonly annotationEnabled: boolean;
  readonly height: number;
  readonly onReviewPoint?: (x: number, y: number) => void;
  readonly reviewPoints: readonly ContentReviewPoint[];
  readonly svg: string;
  readonly width: number;
  readonly zoomCommand: PeleDiagramZoomCommand;
}): ReactElement {
  const [viewport, setViewport] = useState({ height: 0, width: 0 });
  const fit = containSize({ height, width }, viewport);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  const placeReviewPoint = useEvent((x: number, y: number) => {
    onReviewPoint?.(x, y);
  });

  useEffect(() => {
    if (zoomCommand.id === 0) {
      return;
    }
    if (zoomCommand.kind === "reset") {
      scale.set(withTiming(1, { duration: ZOOM_ANIMATION_MS, easing: Easing.out(Easing.cubic) }));
      translateX.set(
        withTiming(0, { duration: ZOOM_ANIMATION_MS, easing: Easing.out(Easing.cubic) }),
      );
      translateY.set(
        withTiming(0, { duration: ZOOM_ANIMATION_MS, easing: Easing.out(Easing.cubic) }),
      );
      return;
    }
    const factor = zoomCommand.kind === "in" ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR;
    const nextScale = Math.max(1, Math.min(MAX_ZOOM, scale.get() * factor));
    scale.set(
      withTiming(nextScale, { duration: ZOOM_ANIMATION_MS, easing: Easing.out(Easing.cubic) }),
    );
    if (nextScale === 1) {
      translateX.set(
        withTiming(0, { duration: ZOOM_ANIMATION_MS, easing: Easing.out(Easing.cubic) }),
      );
      translateY.set(
        withTiming(0, { duration: ZOOM_ANIMATION_MS, easing: Easing.out(Easing.cubic) }),
      );
    }
  }, [scale, translateX, translateY, zoomCommand]);

  const pan = Gesture.Pan()
    .enabled(!annotationEnabled)
    .minDistance(MIN_PAN_DISTANCE)
    .averageTouches(true)
    .onBegin(() => {
      savedX.set(translateX.get());
      savedY.set(translateY.get());
    })
    .onUpdate((event) => {
      const maxX = Math.max(0, (fit.width * scale.get() - viewport.width) * HALF);
      const maxY = Math.max(0, (fit.height * scale.get() - viewport.height) * HALF);
      translateX.set(Math.max(-maxX, Math.min(maxX, savedX.get() + event.translationX)));
      translateY.set(Math.max(-maxY, Math.min(maxY, savedY.get() + event.translationY)));
    });
  const pinch = Gesture.Pinch()
    .enabled(!annotationEnabled)
    .onBegin(() => {
      savedScale.set(scale.get());
    })
    .onUpdate((event) => {
      scale.set(Math.max(1, Math.min(MAX_ZOOM, savedScale.get() * event.scale)));
    })
    .onEnd(() => {
      const maxX = Math.max(0, (fit.width * scale.get() - viewport.width) * HALF);
      const maxY = Math.max(0, (fit.height * scale.get() - viewport.height) * HALF);
      translateX.set(Math.max(-maxX, Math.min(maxX, translateX.get())));
      translateY.set(Math.max(-maxY, Math.min(maxY, translateY.get())));
    });
  const reviewTap = Gesture.Tap()
    .enabled(annotationEnabled)
    .onEnd((event, success) => {
      if (!success || fit.width <= 0 || fit.height <= 0) {
        return;
      }
      const x =
        (event.x - viewport.width * HALF - translateX.get()) / (fit.width * scale.get()) + HALF;
      const y =
        (event.y - viewport.height * HALF - translateY.get()) / (fit.height * scale.get()) + HALF;
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
        scheduleOnRN(placeReviewPoint, x, y);
      }
    });
  const gesture = Gesture.Simultaneous(pan, pinch, reviewTap);
  const transform = { scale, translateX, translateY };

  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
      <GestureDetector gesture={gesture}>
        <PeleDiagramViewport
          fit={fit}
          onSize={(next) => {
            setViewport((current) =>
              current.height === next.height && current.width === next.width ? current : next,
            );
          }}
          reviewPoints={reviewPoints}
          svg={svg}
          transform={transform}
          viewport={viewport}
        />
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

function PeleDiagramViewport({
  fit,
  onSize,
  reviewPoints,
  svg,
  transform,
  viewport,
}: {
  readonly fit: Size;
  readonly onSize: (size: Size) => void;
  readonly reviewPoints: readonly ContentReviewPoint[];
  readonly svg: string;
  readonly transform: DiagramTransform;
  readonly viewport: Size;
}): ReactElement {
  return (
    <View
      onLayout={({ nativeEvent }) => {
        onSize({
          height: Math.max(0, nativeEvent.layout.height),
          width: Math.max(0, nativeEvent.layout.width),
        });
      }}
      style={styles.fullscreenViewport}
    >
      <PeleDiagramLayer
        fit={fit}
        reviewPoints={reviewPoints}
        svg={svg}
        transform={transform}
        viewport={viewport}
      />
    </View>
  );
}

function PeleDiagramLayer({
  fit,
  reviewPoints,
  svg,
  transform,
  viewport,
}: {
  readonly fit: Size;
  readonly reviewPoints: readonly ContentReviewPoint[];
  readonly svg: string;
  readonly transform: DiagramTransform;
  readonly viewport: Size;
}): ReactElement | null {
  const diagramStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: transform.translateX.get() },
      { translateY: transform.translateY.get() },
      { scale: transform.scale.get() },
    ],
  }));
  if (fit.width <= 0 || fit.height <= 0) {
    return null;
  }
  return (
    <Animated.View
      style={[
        styles.diagram,
        {
          height: fit.height,
          left: (viewport.width - fit.width) * HALF,
          top: (viewport.height - fit.height) * HALF,
          width: fit.width,
        },
        diagramStyle,
      ]}
    >
      <PeleDiagramArtwork
        height={fit.height}
        reviewPoints={reviewPoints}
        svg={svg}
        width={fit.width}
      />
    </Animated.View>
  );
}

function usePeleDiagramResource(
  active: boolean,
  source: string,
): AsyncResourceSnapshot<PeleDiagramRenderResult> {
  return useAsyncResource<PeleDiagramRenderResult>(
    active ? peleDiagramKey(source) : null,
    0,
    async (_publish, signal) => renderPeleDiagram(source, signal),
    (result) =>
      result.status === "ready"
        ? result.svg.length * STRING_BYTES_PER_CHAR
        : result.message.length * STRING_BYTES_PER_CHAR,
  );
}

function containSize(source: Size, viewport: Size): Size {
  if (source.width <= 0 || source.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return { height: 0, width: 0 };
  }
  const scale = Math.min(viewport.width / source.width, viewport.height / source.height);
  return { height: source.height * scale, width: source.width * scale };
}

function diagramError(
  resourceError: string | null,
  result: PeleDiagramRenderResult | null,
): string | null {
  if (resourceError !== null) {
    return resourceError;
  }
  return result?.status === "error" ? result.message : null;
}

function PeleDiagramArtwork({
  height,
  reviewPoints,
  svg,
  width,
}: {
  readonly height: number;
  readonly reviewPoints: readonly ContentReviewPoint[];
  readonly svg: string;
  readonly width: number;
}): ReactElement {
  return (
    <>
      <SvgXml height="100%" preserveAspectRatio="xMidYMid meet" width="100%" xml={svg} />
      {reviewPoints.map((point) => (
        <DiagramReviewPoint height={height} key={point.id} point={point} width={width} />
      ))}
    </>
  );
}

function DiagramReviewPoint({
  height,
  point,
  width,
}: {
  readonly height: number;
  readonly point: ContentReviewPoint;
  readonly width: number;
}): ReactElement {
  return (
    <View
      pointerEvents="none"
      style={[
        styles.reviewPoint,
        {
          left: point.x * width,
          opacity: point.pending ? PENDING_REVIEW_OPACITY : 1,
          top: point.y * height,
        },
      ]}
    >
      <Ionicons color={colors.text} name="pin" size={iconSize.indicator} />
    </View>
  );
}

function DiagramStatus({
  icon,
  message,
  role,
}: {
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly message: string;
  readonly role?: "alert";
}): ReactElement {
  return (
    <View accessibilityRole={role} style={styles.status}>
      <Ionicons
        color={role === "alert" ? colors.amber : colors.textMuted}
        name={icon}
        size={iconSize.inline}
      />
      <AppText
        numberOfLines={ERROR_LINE_LIMIT}
        selectable={role === "alert"}
        style={styles.statusText}
      >
        {message}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  diagram: { position: "absolute" },
  fullscreenStatus: {
    alignItems: "center",
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: "center",
    padding: spacing.md,
  },
  fullscreenViewport: {
    backgroundColor: colors.background,
    flex: 1,
    overflow: "hidden",
  },
  gestureRoot: { flex: 1 },
  preview: {
    backgroundColor: colors.surfaceRaised,
    flex: 1,
    padding: spacing.xs,
    width: "100%",
  },
  reviewPoint: {
    alignItems: "center",
    backgroundColor: colors.nebula,
    borderColor: colors.text,
    borderRadius: radii.medium,
    borderWidth: 1,
    height: REVIEW_POINT_SIZE,
    justifyContent: "center",
    position: "absolute",
    transform: [
      { translateX: -REVIEW_POINT_SIZE * HALF },
      { translateY: -REVIEW_POINT_SIZE * HALF },
    ],
    width: REVIEW_POINT_SIZE,
  },
  status: {
    alignItems: "center",
    flex: 1,
    gap: spacing.xs,
    justifyContent: "center",
  },
  statusText: {
    color: colors.textMuted,
    maxWidth: STATUS_MAX_WIDTH,
    textAlign: "center",
    ...typeScale.label,
    fontWeight: typeWeight.medium,
  },
});
