import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState, type RefObject } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import {
  colors,
  radii,
  spacing,
  touchTarget,
  typeScale,
  typeWeight,
  iconSize,
  layoutSize,
  controlSize,
} from "../theme";
import { useAppFullscreenOverlay } from "../ui/AppFullscreenOverlay";
import { useFullscreenWindowReady } from "../ui/FullscreenWindowReady";
import { AppText as Text } from "../ui/Typography";
import {
  ContentReviewComments,
  ContentReviewComposer,
  useContentReview,
  useContentReviewPoints,
  type ContentReviewPoint,
} from "./ContentReviewHost";
import type { ContentReviewTarget } from "./content-review";
import { NativeCodeBlock } from "./NativeCodeBlock";
import { NativeRevealSurface } from "./NativeRevealSurface";
import { FluidLayoutFrame } from "./FluidLayoutFrame";
import { DiagramSvgPreview } from "./DiagramSvgPreview.native";
import { INLINE_MEDIA_PREVIEW_HEIGHT } from "./InlineMediaFrame";

const MAX_SOURCE_CHARS = 128 * 1024;
const MAX_HEIGHT = 440;

type DiagramEngine = {
  kind: "mermaid" | "ascii";
  title: string;
  rendererUri: string;
  renderFunction: "renderMermaid" | "renderAsciiDiagram";
};

const MERMAID_ENGINE: DiagramEngine = {
  kind: "mermaid",
  title: "Mermaid",
  rendererUri: "file:///android_asset/mermaid-renderer.html",
  renderFunction: "renderMermaid",
};

const ASCII_ENGINE: DiagramEngine = {
  kind: "ascii",
  title: "Diagram",
  rendererUri: "file:///android_asset/ascii-diagram-renderer.html",
  renderFunction: "renderAsciiDiagram",
};

type MermaidRendererMessage = {
  type?: string;
  requestId?: number;
  height?: number;
  message?: string;
  x?: number;
  y?: number;
};

type DiagramStatus = "loading" | "rendered" | "error";

function parseRendererMessage(value: string): MermaidRendererMessage | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as MermaidRendererMessage)
      : null;
  } catch {
    return null;
  }
}

function rendererCommand(
  engine: DiagramEngine,
  source: string,
  requestId: number,
  mode: "inline" | "fullscreen",
): string {
  return `(() => {
    if (typeof window.${engine.renderFunction} !== 'function') {
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'error',requestId:${requestId},message:'Bundled ${engine.title} renderer did not initialize'}));
      return;
    }
    window.${engine.renderFunction}(${JSON.stringify(source)},${requestId},${JSON.stringify(mode)});
  })();true;`;
}

export function MermaidDiagram({
  source,
  reviewTarget,
  diagramId,
  reveal = false,
}: {
  source: string;
  reviewTarget?: ContentReviewTarget;
  diagramId?: string;
  reveal?: boolean;
}) {
  return (
    <LocalDiagram
      engine={MERMAID_ENGINE}
      source={source}
      reveal={reveal}
      {...(reviewTarget === undefined ? {} : { reviewTarget })}
      {...(diagramId === undefined ? {} : { diagramId })}
    />
  );
}

export function AsciiDiagram({ source }: { source: string }) {
  return <LocalDiagram engine={ASCII_ENGINE} source={source} />;
}

function LocalDiagram({
  engine,
  source,
  reviewTarget,
  diagramId,
  reveal = false,
}: {
  engine: DiagramEngine;
  source: string;
  reviewTarget?: ContentReviewTarget;
  diagramId?: string;
  reveal?: boolean;
}) {
  const fullscreenOverlay = useAppFullscreenOverlay();
  const inlineWebView = useRef<WebView>(null);
  const [copied, setCopied] = useState(false);
  const [renderedKey, setRenderedKey] = useState<string | null>(null);
  const tooLarge = source.length > MAX_SOURCE_CHARS;
  const boundedSource = tooLarge ? "" : source;
  const renderKey = `${engine.kind}:${boundedSource}`;

  const copySource = () => {
    void Clipboard.setStringAsync(source);
    setCopied(true);
  };

  const openFullscreen = () =>
    fullscreenOverlay.present(({ close }) => (
      <FullscreenDiagram
        engine={engine}
        source={boundedSource}
        onClose={close}
        onCopy={copySource}
        {...(reviewTarget === undefined || diagramId === undefined
          ? {}
          : { reviewTarget, diagramId })}
      />
    ));

  if (tooLarge) {
    return (
      <DiagramFallback
        engine={engine}
        source={source}
        message="Diagram is too large to preview safely"
      />
    );
  }

  return (
    <FluidLayoutFrame animate={reveal} style={styles.inlineReveal}>
      <NativeRevealSurface
        animate={reveal}
        ready={!reveal || renderedKey === renderKey}
        revealKey={renderKey}
        style={styles.inlineReveal}
      >
        <View accessibilityLabel={`${engine.title} diagram`} style={styles.card}>
          <View style={styles.header}>
            <Ionicons name="git-network-outline" size={iconSize.inline} color={colors.textMuted} />
            <Text style={styles.title}>{engine.title}</Text>
            <DiagramIconButton
              accessibilityLabel={`Copy ${engine.title} source`}
              icon={copied ? "checkmark" : "copy-outline"}
              color={copied ? colors.green : colors.textMuted}
              onPress={copySource}
            />
            <DiagramIconButton
              accessibilityLabel="Open diagram fullscreen"
              icon="expand-outline"
              onPress={openFullscreen}
            />
          </View>
          {engine.kind === "mermaid" ? (
            <DiagramSvgPreview
              source={boundedSource}
              onOpen={openFullscreen}
              onSettled={() => setRenderedKey(renderKey)}
            />
          ) : (
            <DiagramSurface
              engine={engine}
              mode="inline"
              source={boundedSource}
              webViewRef={inlineWebView}
              style={{ height: INLINE_MEDIA_PREVIEW_HEIGHT }}
              onSettled={() => setRenderedKey(renderKey)}
            />
          )}
        </View>
      </NativeRevealSurface>
      {reveal && renderedKey !== renderKey && (
        <View pointerEvents="none" style={styles.preparing}>
          <Text style={styles.title}>Rendering diagram…</Text>
        </View>
      )}
    </FluidLayoutFrame>
  );
}

function FullscreenDiagram({
  engine,
  source,
  onClose,
  onCopy,
  reviewTarget,
  diagramId,
}: {
  engine: DiagramEngine;
  source: string;
  onClose(): void;
  onCopy(): void;
  reviewTarget?: ContentReviewTarget;
  diagramId?: string;
}) {
  const fullscreenReady = useFullscreenWindowReady();
  const fullscreenWebView = useRef<WebView>(null);
  const beginReview = useContentReview();
  const [annotating, setAnnotating] = useState(false);
  const reviewPoints = useContentReviewPoints(reviewTarget?.id ?? "", diagramId ?? "");
  const toggleAnnotating = () => {
    const next = !annotating;
    setAnnotating(next);
    inject(fullscreenWebView, `window.diagramSetAnnotationMode(${next ? "true" : "false"});true;`);
  };
  const reviewPoint = (x: number, y: number) => {
    if (reviewTarget === undefined || diagramId === undefined) return;
    void beginReview({ kind: "mermaid", target: reviewTarget, diagramId, source, x, y });
  };
  return (
    <View style={styles.fullscreen}>
      <DiagramSurface
        engine={engine}
        enabled={fullscreenReady}
        mode="fullscreen"
        source={source}
        webViewRef={fullscreenWebView}
        style={styles.fullscreenSurface}
        annotationEnabled={annotating}
        reviewPoints={reviewPoints}
        onReviewPoint={reviewPoint}
      />
      <View pointerEvents="box-none" style={styles.fullscreenTopBar}>
        <DiagramIconButton
          accessibilityLabel="Close diagram"
          icon="close"
          emphasized
          onPress={onClose}
        />
        <View style={styles.fullscreenTitle}>
          <Text numberOfLines={1} style={styles.fullscreenTitleText}>
            {engine.title} diagram
          </Text>
          <Text style={styles.fullscreenHint}>
            {annotating ? "Tap the diagram to add a review point" : "Pinch or drag to inspect"}
          </Text>
        </View>
        {engine.kind === "mermaid" && reviewTarget !== undefined && diagramId !== undefined && (
          <DiagramIconButton
            accessibilityLabel={annotating ? "Stop annotating diagram" : "Annotate diagram"}
            icon="pin-outline"
            color={annotating ? "#ffffff" : colors.textMuted}
            emphasized
            active={annotating}
            onPress={toggleAnnotating}
          />
        )}
        <DiagramIconButton
          accessibilityLabel={`Copy ${engine.title} source`}
          icon="copy-outline"
          emphasized
          onPress={onCopy}
        />
      </View>
      <View style={styles.zoomBar}>
        <DiagramIconButton
          accessibilityLabel="Zoom out"
          icon="remove"
          emphasized
          onPress={() => inject(fullscreenWebView, "window.diagramZoom(.8,-1);true;")}
        />
        <DiagramIconButton
          accessibilityLabel="Reset zoom"
          icon="scan-outline"
          emphasized
          onPress={() => inject(fullscreenWebView, "window.diagramReset(-1);true;")}
        />
        <DiagramIconButton
          accessibilityLabel="Zoom in"
          icon="add"
          emphasized
          onPress={() => inject(fullscreenWebView, "window.diagramZoom(1.25,-1);true;")}
        />
      </View>
      {reviewTarget !== undefined && diagramId !== undefined && (
        <>
          <ContentReviewComments
            targetId={reviewTarget.id}
            diagramId={diagramId}
            presentation="overlay"
            bottomOffset={76}
          />
          <ContentReviewComposer
            targetId={reviewTarget.id}
            anchorKind="mermaid"
            diagramId={diagramId}
          />
        </>
      )}
    </View>
  );
}

function DiagramSurface({
  engine,
  enabled = true,
  mode,
  source,
  webViewRef,
  style,
  onSettled,
  annotationEnabled = false,
  reviewPoints = [],
  onReviewPoint,
}: {
  engine: DiagramEngine;
  enabled?: boolean;
  mode: "inline" | "fullscreen";
  source: string;
  webViewRef: RefObject<WebView | null>;
  style: ViewStyle;
  onSettled?(): void;
  annotationEnabled?: boolean;
  reviewPoints?: readonly ContentReviewPoint[];
  onReviewPoint?(x: number, y: number): void;
}) {
  const loaded = useRef(false);
  const requestId = useRef(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [status, setStatus] = useState<DiagramStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  const render = () => {
    if (!loaded.current) return;
    requestId.current += 1;
    setStatus("loading");
    setError(null);
    webViewRef.current?.injectJavaScript(rendererCommand(engine, source, requestId.current, mode));
  };

  useEffect(() => {
    if (!loaded.current) return;
    requestId.current += 1;
    setStatus("loading");
    setError(null);
    webViewRef.current?.injectJavaScript(rendererCommand(engine, source, requestId.current, mode));
  }, [engine, mode, source, webViewRef]);

  useEffect(() => {
    if (!loaded.current || mode !== "fullscreen") return;
    inject(
      webViewRef,
      `window.diagramSetAnnotationMode(${annotationEnabled ? "true" : "false"});true;`,
    );
  }, [annotationEnabled, mode, webViewRef]);

  const reviewPointsKey = JSON.stringify(reviewPoints);
  useEffect(() => {
    if (!loaded.current || mode !== "fullscreen") return;
    inject(webViewRef, `window.diagramSetReviewPoints(${reviewPointsKey});true;`);
  }, [mode, reviewPointsKey, webViewRef]);

  const fail = (message: string) => {
    setError(message);
    setStatus("error");
    onSettled?.();
  };

  const onMessage = ({ nativeEvent }: WebViewMessageEvent) => {
    const message = parseRendererMessage(nativeEvent.data);
    if (message === null) {
      fail(`Invalid response from the ${engine.title} renderer`);
      return;
    }
    if (message.type === "ready") {
      // Android WebView may finish its native navigation before the deferred
      // Mermaid bundle has installed `renderMermaid`. The old onLoadEnd-only
      // injection then failed once and left a permanently blank surface.
      loaded.current = true;
      render();
      return;
    }
    if (message.requestId !== requestId.current) return;
    if (message.type === "reviewPoint") {
      if (typeof message.x === "number" && typeof message.y === "number")
        onReviewPoint?.(message.x, message.y);
      return;
    }
    if (message.type === "rendered") {
      if (mode === "fullscreen") {
        inject(
          webViewRef,
          `window.diagramSetAnnotationMode(${annotationEnabled ? "true" : "false"});true;`,
        );
        inject(webViewRef, `window.diagramSetReviewPoints(${reviewPointsKey});true;`);
      }
      setStatus("rendered");
      onSettled?.();
      return;
    }
    if (message.type === "error") {
      fail(typeof message.message === "string" ? message.message : `Unknown ${engine.title} error`);
    }
  };

  const onWebViewError = ({ nativeEvent }: { nativeEvent: { description?: string } }) =>
    fail(nativeEvent.description || `${engine.title} WebView failed to load`);
  const onHttpError = ({ nativeEvent }: { nativeEvent: { statusCode: number } }) =>
    fail(`${engine.title} asset returned HTTP ${nativeEvent.statusCode}`);
  const restartRenderer = () => {
    loaded.current = false;
    setStatus("loading");
    setError(null);
    webViewRef.current?.reload();
  };

  return (
    <View
      onLayout={({ nativeEvent }) => {
        const nextWidth = Math.max(0, Math.floor(nativeEvent.layout.width));
        setViewportWidth((current) => (current === nextWidth ? current : nextWidth));
      }}
      style={[styles.viewport, style]}
    >
      {enabled && viewportWidth > 0 && (
        <WebView
          key={`${mode}:${viewportWidth}`}
          ref={webViewRef}
          source={{ uri: engine.rendererUri }}
          originWhitelist={["file://*"]}
          onLoadStart={() => setStatus("loading")}
          onMessage={onMessage}
          onError={onWebViewError}
          onHttpError={onHttpError}
          onContentProcessDidTerminate={restartRenderer}
          onRenderProcessGone={restartRenderer}
          javaScriptEnabled
          allowFileAccess
          allowFileAccessFromFileURLs
          allowUniversalAccessFromFileURLs={false}
          javaScriptCanOpenWindowsAutomatically={false}
          mixedContentMode="never"
          setSupportMultipleWindows={false}
          nestedScrollEnabled
          scrollEnabled={false}
          setBuiltInZoomControls={false}
          setDisplayZoomControls={false}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          androidLayerType="hardware"
          style={[styles.webView, { width: viewportWidth }]}
        />
      )}
      {status === "loading" && (
        <View pointerEvents="none" style={styles.statusOverlay}>
          <ActivityIndicator size="small" color={colors.textMuted} />
          <Text style={styles.statusText}>Rendering diagram…</Text>
        </View>
      )}
      {status === "error" && engine.kind === "ascii" && (
        <View style={styles.asciiFallback}>
          <View style={styles.asciiFallbackHeader}>
            <Ionicons name="warning-outline" size={iconSize.inline} color={colors.amber} />
            <Text numberOfLines={2} style={styles.asciiFallbackText}>
              Could not render diagram · showing source
            </Text>
            <DiagramIconButton
              accessibilityLabel="Retry ASCII diagram"
              icon="refresh"
              onPress={render}
            />
          </View>
          <NativeCodeBlock
            value={source}
            language="text"
            maxHeight={mode === "inline" ? INLINE_MEDIA_PREVIEW_HEIGHT - 64 : MAX_HEIGHT - 48}
          />
        </View>
      )}
      {status === "error" && engine.kind !== "ascii" && (
        <View style={styles.statusOverlay}>
          <Ionicons name="warning-outline" size={iconSize.action} color={colors.amber} />
          <Text selectable numberOfLines={5} style={styles.error}>
            {error ?? `${engine.title} renderer failed`}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Retry ${engine.title} diagram`}
            onPress={render}
            style={styles.retryButton}
          >
            <Ionicons name="refresh" size={iconSize.inline} color={colors.text} />
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function inject(ref: RefObject<WebView | null>, command: string): void {
  ref.current?.injectJavaScript(command);
}

function DiagramIconButton({
  accessibilityLabel,
  icon,
  color,
  emphasized = false,
  active = false,
  onPress,
}: {
  accessibilityLabel: string;
  icon: keyof typeof Ionicons.glyphMap;
  color?: string;
  emphasized?: boolean;
  active?: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        emphasized && styles.iconButtonEmphasized,
        active && styles.iconButtonActive,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons
        name={icon}
        size={iconSize.action}
        color={color ?? (emphasized ? colors.text : colors.textMuted)}
      />
    </Pressable>
  );
}

function DiagramFallback({
  engine,
  source,
  message,
}: {
  engine: DiagramEngine;
  source: string;
  message: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <View style={styles.fallback}>
      <View style={styles.header}>
        <Ionicons name="git-network-outline" size={iconSize.inline} color={colors.textMuted} />
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{engine.title} diagram</Text>
          <Text style={styles.subtitle}>{message}</Text>
        </View>
        <DiagramIconButton
          accessibilityLabel={`Copy ${engine.title} source`}
          icon={copied ? "checkmark" : "copy-outline"}
          color={copied ? colors.green : colors.textMuted}
          onPress={() => {
            void Clipboard.setStringAsync(source);
            setCopied(true);
          }}
        />
      </View>
      {engine.kind === "ascii" && <NativeCodeBlock value={source} language="text" />}
    </View>
  );
}

const styles = StyleSheet.create({
  preparing: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.code,
  },
  inlineReveal: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    alignSelf: "stretch",
  },
  card: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    alignSelf: "stretch",
    overflow: "hidden",
    borderRadius: radii.medium,
    backgroundColor: colors.surfaceRaised,
  },
  header: {
    minWidth: 0,
    minHeight: layoutSize.header,
    paddingLeft: spacing.inputInset,
    paddingRight: spacing.xxs,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  titleBlock: {
    minWidth: 0,
    flex: 1,
  },
  title: {
    minWidth: 0,
    flex: 1,
    color: colors.text,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  subtitle: {
    color: colors.textMuted,
    ...typeScale.caption,
  },
  viewport: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    alignSelf: "stretch",
    overflow: "hidden",
    backgroundColor: colors.surfaceRaised,
  },
  // Android WebView does not reliably infer its cross-axis size from flex alone
  // when it is nested in a measured Markdown block. It then creates a 0px CSS
  // viewport even though the native card itself has a real width.
  webView: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.surfaceRaised,
  },
  statusOverlay: {
    position: "absolute",
    inset: 0,
    padding: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    backgroundColor: colors.surfaceRaised,
  },
  asciiFallback: {
    position: "absolute",
    inset: 0,
    paddingHorizontal: spacing.xs,
    paddingBottom: spacing.xs,
    backgroundColor: colors.surfaceRaised,
  },
  asciiFallbackHeader: {
    minHeight: controlSize.regular,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.compact,
  },
  asciiFallbackText: {
    minWidth: 0,
    flex: 1,
    color: colors.textMuted,
    ...typeScale.caption,
  },
  statusText: {
    color: colors.textMuted,
    ...typeScale.label,
  },
  error: {
    maxWidth: 520,
    color: colors.textMuted,
    ...typeScale.code,
    fontFamily: "monospace",
    textAlign: "center",
  },
  retryButton: {
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.md,
    borderRadius: radii.selected,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.compact,
    backgroundColor: colors.surface,
  },
  retryText: {
    color: colors.text,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  iconButton: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: radii.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonEmphasized: { backgroundColor: "rgba(35, 39, 44, .88)" },
  iconButtonActive: {
    backgroundColor: "rgba(183, 148, 246, .52)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.82)",
  },
  pressed: { opacity: 0.62 },
  fallback: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    borderRadius: radii.medium,
    backgroundColor: colors.surfaceRaised,
    paddingVertical: spacing.xxs,
  },
  fullscreen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  fullscreenSurface: { flex: 1 },
  fullscreenTopBar: {
    position: "absolute",
    top: spacing.xs,
    left: spacing.sm,
    right: spacing.sm,
    minHeight: touchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  fullscreenTitle: {
    minWidth: 0,
    flex: 1,
    borderRadius: radii.medium,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    backgroundColor: "rgba(35, 39, 44, .88)",
  },
  fullscreenTitleText: {
    color: colors.text,
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
  },
  fullscreenHint: {
    color: colors.textMuted,
    ...typeScale.caption,
  },
  zoomBar: {
    position: "absolute",
    bottom: spacing.md,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    padding: spacing.xxs,
    borderRadius: radii.composer,
    backgroundColor: "rgba(12, 14, 16, .78)",
  },
});
