import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState, type RefObject } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  WebView,
  type WebViewMessageEvent,
} from "react-native-webview";

import { colors, radii, spacing, touchTarget } from "../theme";
import { useAppFullscreenOverlay } from "../ui/AppFullscreenOverlay";
import { AppText as Text } from "../ui/Typography";
import { useRichContentWidth } from "./RichContentLayout";

const MAX_SOURCE_CHARS = 128 * 1024;
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 440;
const RENDERER_URI = "file:///android_asset/mermaid-renderer.html";

type MermaidRendererMessage = {
  type?: string;
  requestId?: number;
  height?: number;
  message?: string;
};

type DiagramStatus = "loading" | "rendered" | "error";

function parseRendererMessage(value: string): MermaidRendererMessage | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as MermaidRendererMessage
      : null;
  } catch {
    return null;
  }
}

function rendererCommand(source: string, requestId: number, mode: "inline" | "fullscreen"): string {
  return `(() => {
    if (typeof window.renderMermaid !== 'function') {
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'error',requestId:${requestId},message:'Bundled Mermaid renderer did not initialize'}));
      return;
    }
    window.renderMermaid(${JSON.stringify(source)},${requestId},${JSON.stringify(mode)});
  })();true;`;
}

export function MermaidDiagram({ source }: { source: string }) {
  const fullscreenOverlay = useAppFullscreenOverlay();
  const availableWidth = useRichContentWidth();
  const inlineWebView = useRef<WebView>(null);
  const [height, setHeight] = useState(MIN_HEIGHT);
  const [copied, setCopied] = useState(false);
  const tooLarge = source.length > MAX_SOURCE_CHARS;
  const boundedSource = tooLarge ? "" : source;

  const copySource = () => {
    void Clipboard.setStringAsync(source);
    setCopied(true);
  };

  if (tooLarge) {
    return <DiagramFallback source={source} message="Diagram is too large to preview safely" />;
  }

  return (
    <View
      accessibilityLabel="Mermaid diagram"
      style={[styles.card, availableWidth !== null && availableWidth > 0 ? { width: availableWidth } : null]}
    >
      <View style={styles.header}>
        <Ionicons name="git-network-outline" size={17} color={colors.textMuted} />
        <Text style={styles.title}>Mermaid</Text>
        <DiagramIconButton
          accessibilityLabel="Copy Mermaid source"
          icon={copied ? "checkmark" : "copy-outline"}
          color={copied ? colors.green : colors.textMuted}
          onPress={copySource}
        />
        <DiagramIconButton
          accessibilityLabel="Open diagram fullscreen"
          icon="expand-outline"
          onPress={() => fullscreenOverlay.present(({ close }) => (
            <FullscreenMermaidDiagram source={boundedSource} onClose={close} onCopy={copySource} />
          ))}
        />
      </View>
      <DiagramSurface
        mode="inline"
        source={boundedSource}
        webViewRef={inlineWebView}
        style={{ height }}
        onHeight={setHeight}
      />
    </View>
  );
}

function FullscreenMermaidDiagram({ source, onClose, onCopy }: { source: string; onClose(): void; onCopy(): void }) {
  const insets = useSafeAreaInsets();
  const fullscreenWebView = useRef<WebView>(null);
  return (
    <View style={[styles.fullscreen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <DiagramSurface mode="fullscreen" source={source} webViewRef={fullscreenWebView} style={styles.fullscreenSurface} />
      <View pointerEvents="box-none" style={[styles.fullscreenTopBar, { top: insets.top + spacing.xs }]}>
        <DiagramIconButton accessibilityLabel="Close diagram" icon="close" emphasized onPress={onClose} />
        <View style={styles.fullscreenTitle}>
          <Text numberOfLines={1} style={styles.fullscreenTitleText}>Mermaid diagram</Text>
          <Text style={styles.fullscreenHint}>Pinch or drag to inspect</Text>
        </View>
        <DiagramIconButton accessibilityLabel="Copy Mermaid source" icon="copy-outline" emphasized onPress={onCopy} />
      </View>
      <View style={[styles.zoomBar, { bottom: insets.bottom + spacing.md }]}>
        <DiagramIconButton accessibilityLabel="Zoom out" icon="remove" emphasized onPress={() => inject(fullscreenWebView, "window.diagramZoom(.8,-1);true;")} />
        <DiagramIconButton accessibilityLabel="Reset zoom" icon="scan-outline" emphasized onPress={() => inject(fullscreenWebView, "window.diagramReset(-1);true;")} />
        <DiagramIconButton accessibilityLabel="Zoom in" icon="add" emphasized onPress={() => inject(fullscreenWebView, "window.diagramZoom(1.25,-1);true;")} />
      </View>
    </View>
  );
}

function DiagramSurface({
  mode,
  source,
  webViewRef,
  style,
  onHeight,
}: {
  mode: "inline" | "fullscreen";
  source: string;
  webViewRef: RefObject<WebView | null>;
  style: ViewStyle;
  onHeight?(height: number): void;
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
    webViewRef.current?.injectJavaScript(rendererCommand(source, requestId.current, mode));
  };

  useEffect(() => {
    if (!loaded.current) return;
    requestId.current += 1;
    setStatus("loading");
    setError(null);
    webViewRef.current?.injectJavaScript(rendererCommand(source, requestId.current, mode));
  }, [mode, source, webViewRef]);

  const fail = (message: string) => {
    setError(message);
    setStatus("error");
  };

  const onMessage = ({ nativeEvent }: WebViewMessageEvent) => {
    const message = parseRendererMessage(nativeEvent.data);
    if (message === null) {
      fail("Invalid response from the Mermaid renderer");
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
    if (message.type === "rendered") {
      if (typeof message.height === "number") {
        onHeight?.(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.ceil(message.height))));
      }
      setStatus("rendered");
      return;
    }
    if (message.type === "error") {
      fail(typeof message.message === "string" ? message.message : "Unknown Mermaid error");
    }
  };

  const onWebViewError = ({ nativeEvent }: { nativeEvent: { description?: string } }) => fail(nativeEvent.description || "Mermaid WebView failed to load");
  const onHttpError = ({ nativeEvent }: { nativeEvent: { statusCode: number } }) => fail(`Mermaid asset returned HTTP ${nativeEvent.statusCode}`);
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
        setViewportWidth((current) => current === nextWidth ? current : nextWidth);
      }}
      style={[styles.viewport, style]}
    >
      {viewportWidth > 0 && <WebView
        key={`${mode}:${viewportWidth}`}
        ref={webViewRef}
        source={{ uri: RENDERER_URI }}
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
      />}
      {status === "loading" && (
        <View pointerEvents="none" style={styles.statusOverlay}>
          <ActivityIndicator size="small" color={colors.textMuted} />
          <Text style={styles.statusText}>Rendering diagram…</Text>
        </View>
      )}
      {status === "error" && (
        <View style={styles.statusOverlay}>
          <Ionicons name="warning-outline" size={20} color={colors.amber} />
          <Text selectable numberOfLines={5} style={styles.error}>{error ?? "Mermaid renderer failed"}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Retry Mermaid diagram" onPress={render} style={styles.retryButton}>
            <Ionicons name="refresh" size={17} color={colors.text} />
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
  color = colors.textMuted,
  emphasized = false,
  onPress,
}: {
  accessibilityLabel: string;
  icon: keyof typeof Ionicons.glyphMap;
  color?: string;
  emphasized?: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, emphasized && styles.iconButtonEmphasized, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={19} color={emphasized ? colors.text : color} />
    </Pressable>
  );
}

function DiagramFallback({ source, message }: { source: string; message: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <View style={styles.fallback}>
      <View style={styles.header}>
        <Ionicons name="git-network-outline" size={17} color={colors.textMuted} />
        <View style={styles.titleBlock}>
          <Text style={styles.title}>Mermaid diagram</Text>
          <Text style={styles.subtitle}>{message}</Text>
        </View>
        <DiagramIconButton
          accessibilityLabel="Copy Mermaid source"
          icon={copied ? "checkmark" : "copy-outline"}
          color={copied ? colors.green : colors.textMuted}
          onPress={() => {
            void Clipboard.setStringAsync(source);
            setCopied(true);
          }}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { minWidth: 0, maxWidth: "100%", alignSelf: "flex-start", overflow: "hidden", borderRadius: radii.medium, backgroundColor: colors.surfaceRaised },
  header: { minWidth: 0, minHeight: 38, paddingLeft: 10, paddingRight: 4, flexDirection: "row", alignItems: "center", gap: 7 },
  titleBlock: { minWidth: 0, flex: 1 },
  title: { minWidth: 0, flex: 1, color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: "700" },
  subtitle: { color: colors.textMuted, fontSize: 10, lineHeight: 14 },
  viewport: { width: "100%", minWidth: 0, maxWidth: "100%", alignSelf: "stretch", overflow: "hidden", backgroundColor: colors.surfaceRaised },
  // Android WebView does not reliably infer its cross-axis size from flex alone
  // when it is nested in a measured Markdown block. It then creates a 0px CSS
  // viewport even though the native card itself has a real width.
  webView: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.surfaceRaised },
  statusOverlay: { position: "absolute", inset: 0, padding: spacing.md, alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.surfaceRaised },
  statusText: { color: colors.textMuted, fontSize: 11, lineHeight: 15 },
  error: { maxWidth: 520, color: colors.textMuted, fontFamily: "monospace", fontSize: 10, lineHeight: 15, textAlign: "center" },
  retryButton: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.surface },
  retryText: { color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: "600" },
  iconButton: { width: touchTarget, height: touchTarget, borderRadius: touchTarget / 2, alignItems: "center", justifyContent: "center" },
  iconButtonEmphasized: { backgroundColor: "rgba(35, 39, 44, .88)" },
  pressed: { opacity: 0.62 },
  fallback: { width: "100%", minWidth: 0, maxWidth: "100%", borderRadius: radii.medium, backgroundColor: colors.surfaceRaised, paddingVertical: 4 },
  fullscreen: { flex: 1, backgroundColor: colors.background },
  fullscreenSurface: { flex: 1 },
  fullscreenTopBar: { position: "absolute", left: spacing.sm, right: spacing.sm, minHeight: touchTarget, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  fullscreenTitle: { minWidth: 0, flex: 1, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, backgroundColor: "rgba(35, 39, 44, .88)" },
  fullscreenTitleText: { color: colors.text, fontSize: 13, lineHeight: 17, fontWeight: "700" },
  fullscreenHint: { color: colors.textMuted, fontSize: 10, lineHeight: 13 },
  zoomBar: { position: "absolute", alignSelf: "center", flexDirection: "row", alignItems: "center", gap: spacing.xs, padding: 4, borderRadius: 28, backgroundColor: "rgba(12, 14, 16, .78)" },
});
