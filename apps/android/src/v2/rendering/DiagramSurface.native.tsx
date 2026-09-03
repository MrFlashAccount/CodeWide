import { useRef, useState, type RefObject } from "react";
import { Pressable, StyleSheet, View, type LayoutChangeEvent, type ViewStyle } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { useEvent } from "../../react/useEvent";
import { useDiagramReviewPointSynchronization } from "../infrastructure/react/useDiagramReviewPointSynchronization.native";
import { PresentationText as Text } from "../presentation/text/ProductText";
import { colors, radii, spacing, touchTarget } from "../theme";
import {
  diagramRendererCommand,
  parseDiagramRendererMessage,
  type DiagramEngine,
} from "./diagramModel";
import type { DiagramReviewPoint } from "./renderingCapabilities";

interface DiagramSurfaceProps {
  annotationEnabled?: boolean;
  engine: DiagramEngine;
  mode: "fullscreen" | "inline";
  onHeight?(height: number): void;
  onReviewPoint?(x: number, y: number): void;
  reviewPoints?: readonly DiagramReviewPoint[];
  source: string;
  style: ViewStyle;
  webViewRef?: RefObject<WebView | null>;
}

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 440;

export function DiagramSurface(props: DiagramSurfaceProps): React.JSX.Element {
  const {
    annotationEnabled = false,
    engine,
    mode,
    onHeight,
    onReviewPoint,
    reviewPoints = [],
    source,
    style,
    webViewRef,
  } = props;
  const fallbackRef = useRef<WebView>(null);
  const activeRef = webViewRef ?? fallbackRef;
  const requestId = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const reviewPointsKey = JSON.stringify(reviewPoints);
  useDiagramReviewPointSynchronization(activeRef, mode === "fullscreen", reviewPointsKey);
  const measure = useEvent((event: LayoutChangeEvent) => {
    setViewportWidth(Math.floor(event.nativeEvent.layout.width));
  });
  const fail = useEvent(() => setError(`${engine.title} renderer failed`));
  const render = useEvent(() => {
    requestId.current += 1;
    setError(null);
    activeRef.current?.injectJavaScript(
      diagramRendererCommand(engine, source, requestId.current, mode),
    );
    if (mode === "fullscreen") {
      activeRef.current?.injectJavaScript(
        `window.diagramSetAnnotationMode(${annotationEnabled ? "true" : "false"});true;`,
      );
    }
  });
  const receive = useEvent((event: WebViewMessageEvent) => {
    const message = parseDiagramRendererMessage(event.nativeEvent.data);
    if (message?.type === "ready") {
      render();
      return;
    }
    if (message?.requestId !== requestId.current) return;
    if (message.type === "rendered" && typeof message.height === "number") {
      if (mode === "fullscreen") {
        activeRef.current?.injectJavaScript(
          `window.diagramSetReviewPoints(${reviewPointsKey});true;`,
        );
      }
      onHeight?.(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.ceil(message.height))));
      return;
    }
    if (
      message.type === "reviewPoint" &&
      typeof message.x === "number" &&
      typeof message.y === "number"
    ) {
      onReviewPoint?.(message.x, message.y);
      return;
    }
    if (message.type === "error") setError(message.message ?? "Diagram renderer failed");
  });
  return (
    <View onLayout={measure} style={[styles.viewport, style]}>
      {viewportWidth <= 0 ? null : (
        <WebView
          key={`${engine.kind}:${mode}:${viewportWidth}:${source}`}
          ref={activeRef}
          javaScriptEnabled
          onError={fail}
          onMessage={receive}
          originWhitelist={["file://*"]}
          scrollEnabled={mode === "fullscreen"}
          source={{ uri: engine.assetUri }}
          style={styles.webView}
        />
      )}
      {error === null ? null : (
        <View accessibilityLiveRegion="polite" style={styles.error}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            accessibilityLabel={`Retry ${engine.title} diagram`}
            accessibilityRole="button"
            onPress={render}
            style={styles.retry}
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  error: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    gap: spacing.xs,
    justifyContent: "center",
    padding: spacing.sm,
  },
  errorText: { color: colors.textMuted, textAlign: "center" },
  retry: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radii.pill,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: touchTarget,
    paddingHorizontal: spacing.md,
  },
  retryText: { color: colors.text },
  viewport: { backgroundColor: colors.surfaceRaised, minWidth: 0, overflow: "hidden" },
  webView: { backgroundColor: "transparent", flex: 1 },
});
