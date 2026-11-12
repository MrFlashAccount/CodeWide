import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";
import Svg, { SvgXml } from "react-native-svg";
import {
  ResumableZoom,
  type ResumableZoomRefType,
  type TapGestureEvent,
} from "react-native-zoom-toolkit";

import { useEvent } from "../react/useEvent";
import { colors, iconSize, radii, spacing, typeScale, typeWeight } from "../theme";
import { AppText } from "../ui/Typography";
import { useAsyncResource, type AsyncResourceSnapshot } from "./async-resource-store";
import type { ContentReviewPoint } from "./ContentReviewHost";
import { DiagramPreviewVisibility } from "./DiagramPreviewViewport";
import { InlineMediaFrame } from "./InlineMediaFrame";
import { peleDiagramKey, renderPeleDiagram } from "./peleDiagramWorker.native";
import type { PeleDiagramRenderResult } from "./peleDiagramRenderer";
import { PELE_DIAGRAM_MAX_ZOOM, supersampling } from "./peleDiagramSupersampling";
import { parsePeleDiagramSvg } from "./peleDiagramSvg";

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
const MAX_ZOOM = PELE_DIAGRAM_MAX_ZOOM;
const PENDING_REVIEW_OPACITY = 0.65;
const REVIEW_POINT_SIZE = 24;
const STATUS_MAX_WIDTH = 520;
const STRING_BYTES_PER_CHAR = 2;
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
  const zoom = useRef<ResumableZoomRefType>(null);
  const transform: DiagramTransform = {
    scale: useSharedValue(1),
    translateX: useSharedValue(0),
    translateY: useSharedValue(0),
  };
  const placeReviewPoint = useEvent((event: TapGestureEvent) => {
    if (fit.width <= 0 || fit.height <= 0) {
      return;
    }
    // The tap lands on the gesture area in its unscaled frame: the whole
    // viewport (`extendGestures`), with the fitted diagram centred in it.
    const x = (event.x - (viewport.width - fit.width) * HALF) / fit.width;
    const y = (event.y - (viewport.height - fit.height) * HALF) / fit.height;
    if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
      onReviewPoint?.(x, y);
    }
  });

  useEffect(() => {
    const controller = zoom.current;
    if (zoomCommand.id === 0 || controller === null) {
      return;
    }
    if (zoomCommand.kind === "reset") {
      controller.reset(true);
      return;
    }
    const factor = zoomCommand.kind === "in" ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR;
    controller.zoom(controller.getState().scale * factor);
  }, [zoomCommand]);

  const zoomed = (
    <ResumableZoom
      // Pinch and drag anywhere in the viewport, not only over the fitted diagram.
      extendGestures
      maxScale={MAX_ZOOM}
      onUpdate={(state) => {
        "worklet";
        transform.scale.set(state.scale);
        transform.translateX.set(state.translateX);
        transform.translateY.set(state.translateY);
      }}
      panEnabled={!annotationEnabled}
      pinchEnabled={!annotationEnabled}
      ref={zoom}
      {...(annotationEnabled ? { onTap: placeReviewPoint } : {})}
    >
      <SupersampledDiagram fit={fit} svg={svg} />
    </ResumableZoom>
  );
  return (
    <GestureHandlerRootView style={styles.gestureRoot}>
      <View
        onLayout={({ nativeEvent }) => {
          const next = {
            height: Math.max(0, nativeEvent.layout.height),
            width: Math.max(0, nativeEvent.layout.width),
          };
          setViewport((current) =>
            current.height === next.height && current.width === next.width ? current : next,
          );
        }}
        style={styles.fullscreenViewport}
      >
        {fit.width > 0 && fit.height > 0 ? zoomed : null}
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
    </GestureHandlerRootView>
  );
}

/**
 * The diagram drawn once at `supersampling` times its fitted size and shown
 * scaled down to it. Android rasterizes an SVG view at its own size, so a
 * zoom up to that factor stays sharp as a plain transform, with no redraw
 * while or after the gesture.
 */
function SupersampledDiagram({
  fit,
  svg,
}: {
  readonly fit: Size;
  readonly svg: string;
}): ReactElement {
  const content = parsePeleDiagramSvg(svg);
  const factor = supersampling(fit);
  const drawn = { height: fit.height * factor, width: fit.width * factor };
  return (
    <View pointerEvents="none" style={[styles.supersampledFrame, fit]}>
      <Svg
        fill={content.fill}
        fontFamily={content.fontFamily}
        fontSize={content.fontSize}
        height={drawn.height}
        preserveAspectRatio="xMidYMid meet"
        style={{
          left: (fit.width - drawn.width) * HALF,
          position: "absolute",
          top: (fit.height - drawn.height) * HALF,
          transform: [{ scale: 1 / factor }],
        }}
        viewBox={content.viewBox}
        width={drawn.width}
      >
        {content.children}
      </Svg>
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
  supersampledFrame: { overflow: "hidden" },
});
