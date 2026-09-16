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
import { useAppDialog } from "../ui/AppDialog";
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
  rendererUri: string;
  renderFunction: "renderMermaid" | "renderAsciiDiagram";
  title: string;
};

const MERMAID_ENGINE: DiagramEngine = {
  kind: "mermaid",
  rendererUri: "file:///android_asset/mermaid-renderer.html",
  renderFunction: "renderMermaid",
  title: "Mermaid",
};

const ASCII_ENGINE: DiagramEngine = {
  kind: "ascii",
  rendererUri: "file:///android_asset/ascii-diagram-renderer.html",
  renderFunction: "renderAsciiDiagram",
  title: "Diagram",
};

type MermaidRendererMessage = {
  height?: number;
  message?: string;
  requestId?: number;
  type?: string;
  x?: number;
  y?: number;
};

type DiagramStatus = "loading" | "rendered" | "error";
const EMPTY_REVIEW_POINTS: readonly ContentReviewPoint[] = [];

function parseRendererMessage(value: string): MermaidRendererMessage | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
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
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'error',requestId:${String(requestId)},message:'Bundled ${engine.title} renderer did not initialize'}));
      return;
    }
    window.${engine.renderFunction}(${JSON.stringify(source)},${String(requestId)},${JSON.stringify(mode)});
  })();true;`;
}

export function MermaidDiagram({
  diagramId,
  reveal = false,
  reviewTarget,
  source,
}: {
  diagramId?: string;
  reveal?: boolean;
  reviewTarget?: ContentReviewTarget;
  source: string;
}) {
  return (
    <LocalDiagram
      engine={MERMAID_ENGINE}
      reveal={reveal}
      source={source}
      {...(reviewTarget === undefined ? {} : { reviewTarget })}
      {...(diagramId === undefined ? {} : { diagramId })}
    />
  );
}

export function AsciiDiagram({ source }: { source: string }) {
  return <LocalDiagram engine={ASCII_ENGINE} source={source} />;
}

function LocalDiagram({
  diagramId,
  engine,
  reveal = false,
  reviewTarget,
  source,
}: {
  diagramId?: string;
  engine: DiagramEngine;
  reveal?: boolean;
  reviewTarget?: ContentReviewTarget;
  source: string;
}) {
  const fullscreenOverlay = useAppFullscreenOverlay();
  const dialog = useAppDialog();
  const inlineWebView = useRef<WebView>(null);
  const [copied, setCopied] = useState(false);
  const [renderedKey, setRenderedKey] = useState<string | null>(null);
  const tooLarge = source.length > MAX_SOURCE_CHARS;
  const boundedSource = tooLarge ? "" : source;
  const renderKey = `${engine.kind}:${boundedSource}`;

  const copySource = () => {
    Clipboard.setStringAsync(source).then(
      () => {
        setCopied(true);
      },
      (error: unknown) => {
        dialog.alert("Copy failed", error instanceof Error ? error.message : "Could not copy");
      },
    );
  };

  const openFullscreen = (): void => {
    fullscreenOverlay.present(({ close }) => (
      <FullscreenDiagram
        engine={engine}
        onClose={close}
        onCopy={copySource}
        source={boundedSource}
        {...(reviewTarget === undefined || diagramId === undefined
          ? {}
          : { diagramId, reviewTarget })}
      />
    ));
  };

  if (tooLarge) {
    return (
      <DiagramFallback
        engine={engine}
        message="Diagram is too large to preview safely"
        source={source}
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
            <Ionicons color={colors.textMuted} name="git-network-outline" size={iconSize.inline} />
            <Text style={styles.title}>{engine.title}</Text>
            <DiagramIconButton
              accessibilityLabel={`Copy ${engine.title} source`}
              color={copied ? colors.green : colors.textMuted}
              icon={copied ? "checkmark" : "copy-outline"}
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
              onOpen={openFullscreen}
              onSettled={() => {
                setRenderedKey(renderKey);
              }}
              source={boundedSource}
            />
          ) : (
            <DiagramSurface
              engine={engine}
              key={`${engine.kind}:inline:${boundedSource}`}
              mode="inline"
              onSettled={() => {
                setRenderedKey(renderKey);
              }}
              source={boundedSource}
              style={{ height: INLINE_MEDIA_PREVIEW_HEIGHT }}
              webViewRef={inlineWebView}
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
  diagramId,
  engine,
  onClose,
  onCopy,
  reviewTarget,
  source,
}: {
  diagramId?: string;
  engine: DiagramEngine;
  onClose: () => void;
  onCopy: () => void;
  reviewTarget?: ContentReviewTarget;
  source: string;
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
    if (reviewTarget === undefined || diagramId === undefined) {
      return;
    }
    beginReview({ diagramId, kind: "mermaid", source, target: reviewTarget, x, y });
  };
  return (
    <View style={styles.fullscreen}>
      <DiagramSurface
        annotationEnabled={annotating}
        enabled={fullscreenReady}
        engine={engine}
        key={`${engine.kind}:fullscreen:${source}`}
        mode="fullscreen"
        onReviewPoint={reviewPoint}
        reviewPoints={reviewPoints}
        source={source}
        style={styles.fullscreenSurface}
        webViewRef={fullscreenWebView}
      />
      <View pointerEvents="box-none" style={styles.fullscreenTopBar}>
        <DiagramIconButton
          accessibilityLabel="Close diagram"
          emphasized
          icon="close"
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
            active={annotating}
            color={annotating ? "#ffffff" : colors.textMuted}
            emphasized
            icon="pin-outline"
            onPress={toggleAnnotating}
          />
        )}
        <DiagramIconButton
          accessibilityLabel={`Copy ${engine.title} source`}
          emphasized
          icon="copy-outline"
          onPress={onCopy}
        />
      </View>
      <View style={styles.zoomBar}>
        <DiagramIconButton
          accessibilityLabel="Zoom out"
          emphasized
          icon="remove"
          onPress={() => {
            inject(fullscreenWebView, "window.diagramZoom(.8,-1);true;");
          }}
        />
        <DiagramIconButton
          accessibilityLabel="Reset zoom"
          emphasized
          icon="scan-outline"
          onPress={() => {
            inject(fullscreenWebView, "window.diagramReset(-1);true;");
          }}
        />
        <DiagramIconButton
          accessibilityLabel="Zoom in"
          emphasized
          icon="add"
          onPress={() => {
            inject(fullscreenWebView, "window.diagramZoom(1.25,-1);true;");
          }}
        />
      </View>
      {reviewTarget !== undefined && diagramId !== undefined && (
        <>
          <ContentReviewComments
            bottomOffset={76}
            diagramId={diagramId}
            presentation="overlay"
            targetId={reviewTarget.id}
          />
          <ContentReviewComposer
            anchorKind="mermaid"
            diagramId={diagramId}
            targetId={reviewTarget.id}
          />
        </>
      )}
    </View>
  );
}

function DiagramSurface({
  annotationEnabled = false,
  enabled = true,
  engine,
  mode,
  onReviewPoint,
  onSettled,
  reviewPoints = EMPTY_REVIEW_POINTS,
  source,
  style,
  webViewRef,
}: {
  annotationEnabled?: boolean;
  enabled?: boolean;
  engine: DiagramEngine;
  mode: "inline" | "fullscreen";
  onReviewPoint?: (x: number, y: number) => void;
  onSettled?: () => void;
  reviewPoints?: readonly ContentReviewPoint[];
  source: string;
  style: ViewStyle;
  webViewRef: RefObject<WebView | null>;
}) {
  const loaded = useRef(false);
  const requestId = useRef(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [status, setStatus] = useState<DiagramStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  const render = () => {
    if (!loaded.current) {
      return;
    }
    requestId.current += 1;
    setStatus("loading");
    setError(null);
    webViewRef.current?.injectJavaScript(rendererCommand(engine, source, requestId.current, mode));
  };

  useEffect(() => {
    if (!loaded.current || mode !== "fullscreen") {
      return;
    }
    inject(
      webViewRef,
      `window.diagramSetAnnotationMode(${annotationEnabled ? "true" : "false"});true;`,
    );
  }, [annotationEnabled, mode, webViewRef]);

  const reviewPointsKey = JSON.stringify(reviewPoints);
  useEffect(() => {
    if (!loaded.current || mode !== "fullscreen") {
      return;
    }
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
    if (message.requestId !== requestId.current) {
      return;
    }
    if (message.type === "reviewPoint") {
      if (typeof message.x === "number" && typeof message.y === "number") {
        onReviewPoint?.(message.x, message.y);
      }
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

  const onWebViewError = ({ nativeEvent }: { nativeEvent: { description?: string } }) => {
    const description = nativeEvent.description;
    fail(
      description === undefined || description === ""
        ? `${engine.title} WebView failed to load`
        : description,
    );
  };
  const onHttpError = ({ nativeEvent }: { nativeEvent: { statusCode: number } }) => {
    fail(`${engine.title} asset returned HTTP ${String(nativeEvent.statusCode)}`);
  };
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
          allowFileAccess
          allowFileAccessFromFileURLs
          allowUniversalAccessFromFileURLs={false}
          androidLayerType="hardware"
          javaScriptCanOpenWindowsAutomatically={false}
          javaScriptEnabled
          key={`${mode}:${String(viewportWidth)}`}
          mixedContentMode="never"
          nestedScrollEnabled
          onContentProcessDidTerminate={restartRenderer}
          onError={onWebViewError}
          onHttpError={onHttpError}
          onLoadStart={() => {
            setStatus("loading");
          }}
          onMessage={onMessage}
          onRenderProcessGone={restartRenderer}
          originWhitelist={["file://*"]}
          ref={webViewRef}
          scrollEnabled={false}
          setBuiltInZoomControls={false}
          setDisplayZoomControls={false}
          setSupportMultipleWindows={false}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          source={{ uri: engine.rendererUri }}
          style={[styles.webView, { width: viewportWidth }]}
        />
      )}
      {status === "loading" && (
        <View pointerEvents="none" style={styles.statusOverlay}>
          <ActivityIndicator color={colors.textMuted} size="small" />
          <Text style={styles.statusText}>Rendering diagram…</Text>
        </View>
      )}
      {status === "error" && engine.kind === "ascii" && (
        <View style={styles.asciiFallback}>
          <View style={styles.asciiFallbackHeader}>
            <Ionicons color={colors.amber} name="warning-outline" size={iconSize.inline} />
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
            language="text"
            maxHeight={mode === "inline" ? INLINE_MEDIA_PREVIEW_HEIGHT - 64 : MAX_HEIGHT - 48}
            value={source}
          />
        </View>
      )}
      {status === "error" && engine.kind !== "ascii" && (
        <View style={styles.statusOverlay}>
          <Ionicons color={colors.amber} name="warning-outline" size={iconSize.action} />
          <Text numberOfLines={5} selectable style={styles.error}>
            {error ?? `${engine.title} renderer failed`}
          </Text>
          <Pressable
            accessibilityLabel={`Retry ${engine.title} diagram`}
            accessibilityRole="button"
            onPress={render}
            style={styles.retryButton}
          >
            <Ionicons color={colors.text} name="refresh" size={iconSize.inline} />
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
  active = false,
  color,
  emphasized = false,
  icon,
  onPress,
}: {
  accessibilityLabel: string;
  active?: boolean;
  color?: string;
  emphasized?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
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
        color={color ?? (emphasized ? colors.text : colors.textMuted)}
        name={icon}
        size={iconSize.action}
      />
    </Pressable>
  );
}

function DiagramFallback({
  engine,
  message,
  source,
}: {
  engine: DiagramEngine;
  message: string;
  source: string;
}) {
  const dialog = useAppDialog();
  const [copied, setCopied] = useState(false);
  return (
    <View style={styles.fallback}>
      <View style={styles.header}>
        <Ionicons color={colors.textMuted} name="git-network-outline" size={iconSize.inline} />
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{engine.title} diagram</Text>
          <Text style={styles.subtitle}>{message}</Text>
        </View>
        <DiagramIconButton
          accessibilityLabel={`Copy ${engine.title} source`}
          color={copied ? colors.green : colors.textMuted}
          icon={copied ? "checkmark" : "copy-outline"}
          onPress={() => {
            Clipboard.setStringAsync(source).then(
              () => {
                setCopied(true);
              },
              (error: unknown) => {
                dialog.alert(
                  "Copy failed",
                  error instanceof Error ? error.message : "Could not copy",
                );
              },
            );
          }}
        />
      </View>
      {engine.kind === "ascii" && <NativeCodeBlock language="text" value={source} />}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: "stretch",
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.medium,
    maxWidth: "100%",
    minWidth: 0,
    overflow: "hidden",
    width: "100%",
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: layoutSize.header,
    minWidth: 0,
    paddingLeft: spacing.inputInset,
    paddingRight: spacing.xxs,
  },
  inlineReveal: {
    alignSelf: "stretch",
    maxWidth: "100%",
    minWidth: 0,
    width: "100%",
  },
  preparing: {
    alignItems: "center",
    backgroundColor: colors.code,
    bottom: 0,
    justifyContent: "center",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  subtitle: {
    color: colors.textMuted,
    ...typeScale.caption,
  },
  title: {
    color: colors.text,
    flex: 1,
    minWidth: 0,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
  viewport: {
    alignSelf: "stretch",
    backgroundColor: colors.surfaceRaised,
    maxWidth: "100%",
    minWidth: 0,
    overflow: "hidden",
    width: "100%",
  },
  // Android WebView does not reliably infer its cross-axis size from flex alone
  // when it is nested in a measured Markdown block. It then creates a 0px CSS
  // viewport even though the native card itself has a real width.
  asciiFallback: {
    backgroundColor: colors.surfaceRaised,
    inset: 0,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.xs,
    position: "absolute",
  },
  asciiFallbackHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.compact,
    minHeight: controlSize.regular,
  },
  asciiFallbackText: {
    color: colors.textMuted,
    flex: 1,
    minWidth: 0,
    ...typeScale.caption,
  },
  error: {
    color: colors.textMuted,
    maxWidth: 520,
    ...typeScale.code,
    fontFamily: "monospace",
    textAlign: "center",
  },
  fallback: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.medium,
    maxWidth: "100%",
    minWidth: 0,
    paddingVertical: spacing.xxs,
    width: "100%",
  },
  fullscreen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  fullscreenHint: {
    color: colors.textMuted,
    ...typeScale.caption,
  },
  fullscreenSurface: { flex: 1 },
  fullscreenTitle: {
    backgroundColor: "rgba(35, 39, 44, .88)",
    borderRadius: radii.medium,
    flex: 1,
    minWidth: 0,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  fullscreenTitleText: {
    color: colors.text,
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
  },
  fullscreenTopBar: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    left: spacing.sm,
    minHeight: touchTarget,
    position: "absolute",
    right: spacing.sm,
    top: spacing.xs,
  },
  iconButton: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  iconButtonActive: {
    backgroundColor: "rgba(183, 148, 246, .52)",
    borderColor: "rgba(255,255,255,.82)",
    borderWidth: 1,
  },
  iconButtonEmphasized: { backgroundColor: "rgba(35, 39, 44, .88)" },
  pressed: { opacity: 0.62 },
  retryButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radii.selected,
    flexDirection: "row",
    gap: spacing.compact,
    justifyContent: "center",
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.md,
  },
  retryText: {
    color: colors.text,
    ...typeScale.label,
    fontWeight: typeWeight.semibold,
  },
  statusOverlay: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    gap: spacing.xs,
    inset: 0,
    justifyContent: "center",
    padding: spacing.md,
    position: "absolute",
  },
  statusText: {
    color: colors.textMuted,
    ...typeScale.label,
  },
  webView: {
    backgroundColor: colors.surfaceRaised,
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  zoomBar: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "rgba(12, 14, 16, .78)",
    borderRadius: radii.composer,
    bottom: spacing.md,
    flexDirection: "row",
    gap: spacing.xs,
    padding: spacing.xxs,
    position: "absolute",
  },
});
