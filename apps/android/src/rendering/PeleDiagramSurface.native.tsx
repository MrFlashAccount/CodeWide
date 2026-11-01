import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState, type ReactElement } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  createAnimatedComponent,
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { SvgXml } from "react-native-svg";
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
import { parsePeleDiagramSvg } from "./peleDiagramSvg";
import { peleDiagramTextureTransform, peleDiagramViewBox } from "./peleDiagramViewBox";

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
  readonly committedScale: SharedValue<number>;
  readonly committedTranslateX: SharedValue<number>;
  readonly committedTranslateY: SharedValue<number>;
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
const AnimatedSvg = createAnimatedComponent(Svg);

export type PeleDiagramZoomCommand = {
  readonly id: number;
  readonly kind: "in" | "out" | "reset";
};

interface ZoomCommandTargetInput {
  readonly currentScale: number;
  readonly currentTranslateX: number;
  readonly currentTranslateY: number;
  readonly fitHeight: number;
  readonly fitWidth: number;
  readonly kind: PeleDiagramZoomCommand["kind"];
  readonly viewportHeight: number;
  readonly viewportWidth: number;
}

interface ZoomCommandTarget {
  readonly scale: number;
  readonly translateX: number;
  readonly translateY: number;
}

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
  const committedScale = useSharedValue(1);
  const committedTranslateX = useSharedValue(0);
  const committedTranslateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);
  const activeGestures = useSharedValue(0);
  const textureActive = useSharedValue(false);
  const placeReviewPoint = useEvent((x: number, y: number) => {
    onReviewPoint?.(x, y);
  });

  const beginInteraction = () => {
    "worklet";
    cancelAnimation(scale);
    cancelAnimation(translateX);
    cancelAnimation(translateY);
    const nextActiveGestures = activeGestures.get() + 1;
    activeGestures.set(nextActiveGestures);
    if (nextActiveGestures === 1) {
      textureActive.set(true);
    }
  };
  const finishInteraction = () => {
    "worklet";
    const nextActiveGestures = Math.max(0, activeGestures.get() - 1);
    activeGestures.set(nextActiveGestures);
    if (nextActiveGestures !== 0) {
      return;
    }
    const currentScale = scale.get();
    const maxX = Math.max(0, (fit.width * currentScale - viewport.width) * HALF);
    const maxY = Math.max(0, (fit.height * currentScale - viewport.height) * HALF);
    const currentX = Math.max(-maxX, Math.min(maxX, translateX.get()));
    const currentY = Math.max(-maxY, Math.min(maxY, translateY.get()));
    translateX.set(currentX);
    translateY.set(currentY);
    committedScale.set(currentScale);
    committedTranslateX.set(currentX);
    committedTranslateY.set(currentY);
    textureActive.set(false);
  };

  useEffect(() => {
    if (zoomCommand.id === 0) {
      return;
    }
    const currentScale = scale.get();
    const currentTranslateX = translateX.get();
    const currentTranslateY = translateY.get();
    const target = zoomCommandTarget({
      currentScale,
      currentTranslateX,
      currentTranslateY,
      fitHeight: fit.height,
      fitWidth: fit.width,
      kind: zoomCommand.kind,
      viewportHeight: viewport.height,
      viewportWidth: viewport.width,
    });
    if (
      currentScale === target.scale &&
      currentTranslateX === target.translateX &&
      currentTranslateY === target.translateY
    ) {
      committedScale.set(target.scale);
      committedTranslateX.set(target.translateX);
      committedTranslateY.set(target.translateY);
      textureActive.set(false);
      return;
    }
    textureActive.set(true);
    const animation = { duration: ZOOM_ANIMATION_MS, easing: Easing.out(Easing.cubic) };
    translateX.set(withTiming(target.translateX, animation));
    translateY.set(withTiming(target.translateY, animation));
    scale.set(
      withTiming(target.scale, animation, (finished) => {
        if (finished !== true) {
          return;
        }
        committedScale.set(target.scale);
        committedTranslateX.set(target.translateX);
        committedTranslateY.set(target.translateY);
        textureActive.set(false);
      }),
    );
  }, [
    committedScale,
    committedTranslateX,
    committedTranslateY,
    fit.height,
    fit.width,
    scale,
    textureActive,
    translateX,
    translateY,
    viewport.height,
    viewport.width,
    zoomCommand,
  ]);

  const pan = Gesture.Pan()
    .enabled(!annotationEnabled)
    .minDistance(MIN_PAN_DISTANCE)
    .averageTouches(true)
    .onBegin(() => {
      beginInteraction();
      savedX.set(translateX.get());
      savedY.set(translateY.get());
    })
    .onUpdate((event) => {
      const maxX = Math.max(0, (fit.width * scale.get() - viewport.width) * HALF);
      const maxY = Math.max(0, (fit.height * scale.get() - viewport.height) * HALF);
      translateX.set(Math.max(-maxX, Math.min(maxX, savedX.get() + event.translationX)));
      translateY.set(Math.max(-maxY, Math.min(maxY, savedY.get() + event.translationY)));
    })
    .onFinalize(finishInteraction);
  const pinch = Gesture.Pinch()
    .enabled(!annotationEnabled)
    .onBegin(() => {
      beginInteraction();
      savedScale.set(scale.get());
    })
    .onUpdate((event) => {
      scale.set(Math.max(1, Math.min(MAX_ZOOM, savedScale.get() * event.scale)));
    })
    .onFinalize(finishInteraction);
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
  const transform = {
    committedScale,
    committedTranslateX,
    committedTranslateY,
    scale,
    translateX,
    translateY,
  };

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
          sourceHeight={height}
          sourceWidth={width}
          svg={svg}
          textureActive={textureActive}
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
  sourceHeight,
  sourceWidth,
  svg,
  textureActive,
  transform,
  viewport,
}: {
  readonly fit: Size;
  readonly onSize: (size: Size) => void;
  readonly reviewPoints: readonly ContentReviewPoint[];
  readonly sourceHeight: number;
  readonly sourceWidth: number;
  readonly svg: string;
  readonly textureActive: SharedValue<boolean>;
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
        sourceHeight={sourceHeight}
        sourceWidth={sourceWidth}
        svg={svg}
        textureActive={textureActive}
        transform={transform}
        viewport={viewport}
      />
    </View>
  );
}

function PeleDiagramLayer({
  fit,
  reviewPoints,
  sourceHeight,
  sourceWidth,
  svg,
  textureActive,
  transform,
  viewport,
}: {
  readonly fit: Size;
  readonly reviewPoints: readonly ContentReviewPoint[];
  readonly sourceHeight: number;
  readonly sourceWidth: number;
  readonly svg: string;
  readonly textureActive: SharedValue<boolean>;
  readonly transform: DiagramTransform;
  readonly viewport: Size;
}): ReactElement | null {
  const content = parsePeleDiagramSvg(svg);
  const vectorProps = useAnimatedProps(() => ({
    viewBox: peleDiagramViewBox({
      fitHeight: fit.height,
      fitWidth: fit.width,
      scale: transform.committedScale.get(),
      sourceHeight,
      sourceWidth,
      translateX: transform.committedTranslateX.get(),
      translateY: transform.committedTranslateY.get(),
    }),
  }));
  const textureStyle = useAnimatedStyle(() => {
    const texture = peleDiagramTextureTransform({
      committedScale: transform.committedScale.get(),
      committedTranslateX: transform.committedTranslateX.get(),
      committedTranslateY: transform.committedTranslateY.get(),
      scale: transform.scale.get(),
      translateX: transform.translateX.get(),
      translateY: transform.translateY.get(),
    });
    return {
      transform: [
        { translateX: texture.translateX },
        { translateY: texture.translateY },
        { scale: texture.scale },
      ],
    };
  });
  const textureProps = useAnimatedProps(() => ({
    renderToHardwareTextureAndroid: textureActive.get(),
  }));
  if (fit.width <= 0 || fit.height <= 0) {
    return null;
  }
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View
        animatedProps={textureProps}
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, textureStyle]}
      >
        <AnimatedSvg
          animatedProps={vectorProps}
          fill={content.fill}
          fontFamily={content.fontFamily}
          fontSize={content.fontSize}
          height="100%"
          preserveAspectRatio="xMidYMid meet"
          viewBox={content.viewBox}
          width="100%"
        >
          {content.children}
        </AnimatedSvg>
      </Animated.View>
      {reviewPoints.map((point) => (
        <DiagramReviewPoint
          fit={fit}
          key={point.id}
          point={point}
          transform={transform}
          viewport={viewport}
        />
      ))}
    </View>
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

function zoomCommandTarget(input: ZoomCommandTargetInput): ZoomCommandTarget {
  const scale = zoomCommandScale(input.kind, input.currentScale);
  const maxX = Math.max(0, (input.fitWidth * scale - input.viewportWidth) * HALF);
  const maxY = Math.max(0, (input.fitHeight * scale - input.viewportHeight) * HALF);
  return {
    scale,
    translateX: scale === 1 ? 0 : clampTranslation(input.currentTranslateX, maxX),
    translateY: scale === 1 ? 0 : clampTranslation(input.currentTranslateY, maxY),
  };
}

function zoomCommandScale(kind: PeleDiagramZoomCommand["kind"], currentScale: number): number {
  if (kind === "reset") {
    return 1;
  }
  const factor = kind === "in" ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR;
  return Math.max(1, Math.min(MAX_ZOOM, currentScale * factor));
}

function clampTranslation(value: number, maximum: number): number {
  return Math.max(-maximum, Math.min(maximum, value));
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

function DiagramReviewPoint({
  fit,
  point,
  transform,
  viewport,
}: {
  readonly fit: Size;
  readonly point: ContentReviewPoint;
  readonly transform: DiagramTransform;
  readonly viewport: Size;
}): ReactElement {
  const position = useAnimatedStyle(() => ({
    left:
      viewport.width * HALF +
      transform.translateX.get() +
      (point.x - HALF) * fit.width * transform.scale.get(),
    top:
      viewport.height * HALF +
      transform.translateY.get() +
      (point.y - HALF) * fit.height * transform.scale.get(),
  }));
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.reviewPoint,
        {
          opacity: point.pending ? PENDING_REVIEW_OPACITY : 1,
        },
        position,
      ]}
    >
      <Ionicons color={colors.text} name="pin" size={iconSize.indicator} />
    </Animated.View>
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
