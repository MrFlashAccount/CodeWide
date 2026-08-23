import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, PanResponder, Platform, Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";

import {
  startNativeBrowserDevToolsBridge,
  startNativeBrowserTracing,
  stopNativeBrowserDevToolsBridge,
  stopNativeBrowserTracing,
  type NativeBrowserDevToolsBridge,
} from "../native/native-transport";
import { useEvent } from "../react/useEvent";
import { colors, spacing, touchTarget, typeScale } from "../theme";
import {
  createDevToolsFailure,
  DevToolsErrorBoundary,
  DevToolsFailurePanel,
  type DevToolsFailure,
  type DevToolsFailureKind,
} from "./DevToolsErrorBoundary";
import { AppText as Text } from "./Typography";

type DevToolsTarget = {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
  description?: string;
};
type DevToolsDockSide = "bottom" | "left" | "right" | "undocked";
type InternalBrowserHeader = {
  title: string;
  closeLabel: string;
  onClose(): void;
  closeIcon?: "arrow-back" | "close";
  status?: string;
};

export function InternalBrowser({
  url,
  headers,
  header,
  originWhitelist = ["http://*", "https://*"],
  onHttpError,
  onError,
}: {
  url: string;
  headers?: Record<string, string>;
  header?: InternalBrowserHeader;
  originWhitelist?: string[];
  onHttpError?(statusCode: number): void;
  onError?(description: string): void;
}) {
  const webView = useRef<WebView>(null);
  const devToolsWebView = useRef<WebView>(null);
  const mounted = useRef(true);
  const bridgeStarted = useRef(false);
  const [targetPaneFraction, setTargetPaneFraction] = useState(0.5);
  const [contentSize, setContentSize] = useState({ width: 0, height: 0 });
  const [navigation, setNavigation] = useState<Pick<WebViewNavigation, "url" | "title" | "canGoBack" | "canGoForward">>({
    url,
    title: "",
    canGoBack: false,
    canGoForward: false,
  });
  const [devToolsUrl, setDevToolsUrl] = useState<string | null>(null);
  const [devToolsLoading, setDevToolsLoading] = useState(false);
  const [devToolsDocumentLoading, setDevToolsDocumentLoading] = useState(false);
  const [devToolsFailure, setDevToolsFailure] = useState<DevToolsFailure | null>(null);
  const [devToolsRevision, setDevToolsRevision] = useState(0);
  const [devToolsDockSide, setDevToolsDockSide] = useState<DevToolsDockSide>("bottom");
  const [traceRunning, setTraceRunning] = useState(false);
  const [traceStatus, setTraceStatus] = useState<string | null>(null);
  const [bridge, setBridge] = useState<NativeBrowserDevToolsBridge | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (bridgeStarted.current) {
        bridgeStarted.current = false;
        stopNativeBrowserDevToolsBridge();
      }
    };
  }, []);

  const reportError = useEvent((cause: unknown, fallback: string) => {
    onError?.(cause instanceof Error ? cause.message : fallback);
  });

  const captureDevToolsFailure = useEvent((kind: DevToolsFailureKind, message: string, detail?: string) => {
    const failure = createDevToolsFailure(kind, message, {
      context: [
        `Target: ${browserLocation(navigation.url)}`,
        devToolsUrl === null ? null : `Frontend: ${redactDevToolsUrl(devToolsUrl)}`,
        detail ?? null,
      ].filter((line): line is string => line !== null).join("\n"),
    });
    console.error("Chromium DevTools failure", failure);
    setDevToolsFailure(failure);
    return failure;
  });

  const openDevTools = useEvent(async () => {
    setDevToolsLoading(true);
    setDevToolsDocumentLoading(true);
    setDevToolsFailure(null);
    setTraceStatus(null);
    try {
      const endpoint = await startNativeBrowserDevToolsBridge();
      bridgeStarted.current = true;
      const marker = markInspectablePage(webView.current);
      marker.apply();
      const target: DevToolsTarget = await findInspectablePage(endpoint, navigation.url, marker)
        .finally(marker.restore);
      if (mounted.current) {
        setBridge(endpoint);
        setDevToolsUrl(chromiumDevToolsUrl(endpoint, target));
      } else {
        bridgeStarted.current = false;
        stopNativeBrowserDevToolsBridge();
      }
    } catch (cause) {
      if (bridgeStarted.current) {
        bridgeStarted.current = false;
        stopNativeBrowserDevToolsBridge();
      }
      if (mounted.current) {
        setBridge(null);
        setDevToolsUrl(null);
        setDevToolsDocumentLoading(false);
        captureDevToolsFailure("bridge", cause instanceof Error ? cause.message : "Could not connect Chromium DevTools to this page");
        reportError(cause, "Could not connect Chromium DevTools to this page");
      }
    }
    if (mounted.current) setDevToolsLoading(false);
  });

  const closeDevTools = useEvent(() => {
    if (traceRunning) {
      void stopNativeBrowserTracing().catch(() => undefined);
      setTraceRunning(false);
    }
    if (bridgeStarted.current) {
      bridgeStarted.current = false;
      stopNativeBrowserDevToolsBridge();
    }
    setBridge(null);
    setDevToolsUrl(null);
    setDevToolsDocumentLoading(false);
    setDevToolsFailure(null);
    setDevToolsDockSide("bottom");
    setTraceStatus(null);
  });

  useEffect(() => {
    if (Platform.OS !== "android" || header === undefined) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (devToolsUrl !== null) closeDevTools();
      else if (navigation.canGoBack) webView.current?.goBack();
      else header.onClose();
      return true;
    });
    return () => subscription.remove();
  }, [closeDevTools, devToolsUrl, header, navigation.canGoBack]);

  const handleDevToolsMessage = useEvent((event: WebViewMessageEvent) => {
    const message = parseDevToolsMessage(event.nativeEvent.data);
    if (message === null) return;
    if (message.source === "codewide-devtools-dock") {
      setDevToolsDockSide(message.side);
      return;
    }
    if (message.source === "codewide-devtools-transport") {
      if (message.event === "close") {
        const detail = [`Close code: ${message.code}`, message.reason.length > 0 ? `Reason: ${message.reason}` : null]
          .filter((line): line is string => line !== null)
          .join("\n");
        captureDevToolsFailure("bridge", "Chrome DevTools Protocol connection closed", detail);
        onError?.(`Chromium DevTools: CDP connection closed (${message.code})`);
      }
      return;
    }
    setDevToolsDocumentLoading(false);
    if (message.state === "ready") {
      setDevToolsFailure(null);
      return;
    }
    const description = message.message ?? "Chromium DevTools did not render";
    captureDevToolsFailure("health", description);
    onError?.(`Chromium DevTools: ${description}`);
  });

  const retryDevTools = useEvent(() => {
    setDevToolsFailure(null);
    setDevToolsDocumentLoading(true);
    setDevToolsRevision((revision) => revision + 1);
  });

  const toggleTrace = useEvent(async () => {
    try {
      if (!traceRunning) {
        await startNativeBrowserTracing();
        setTraceRunning(true);
        setTraceStatus("Recording native WebView trace");
      } else {
        const result = await stopNativeBrowserTracing();
        setTraceRunning(false);
        setTraceStatus(`Trace captured · ${formatBytes(result.size)}`);
      }
    } catch (cause) {
      setTraceRunning(false);
      reportError(cause, "Could not capture WebView performance trace");
    }
  });

  const dividerPanResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_event, gesture) => {
      const delta = devToolsDockSide === "left" || devToolsDockSide === "right" ? gesture.dx : gesture.dy;
      return Math.abs(delta) > 2;
    },
    onPanResponderMove: (_event, gesture) => {
      const vertical = devToolsDockSide === "left" || devToolsDockSide === "right";
      const axisSize = vertical ? contentSize.width : contentSize.height;
      if (axisSize <= 0) return;
      const delta = vertical ? gesture.dx : gesture.dy;
      const direction = devToolsDockSide === "left" ? -1 : 1;
      const next = clamp(targetPaneFraction + direction * delta / axisSize, 0.2, 0.8);
      setTargetPaneFraction(next);
    },
  });

  const onContentLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setContentSize({ width, height });
  };
  const devToolsOpen = devToolsUrl !== null;
  const verticalDock = devToolsDockSide === "left" || devToolsDockSide === "right";
  const targetPaneStyle = devToolsOpen
    ? devToolsDockSide === "undocked"
      ? [styles.targetPane, styles.targetPaneUndocked]
      : [
          styles.targetPane,
          verticalDock
            ? { width: `${targetPaneFraction * 100}%` as `${number}%` }
            : { height: `${targetPaneFraction * 100}%` as `${number}%` },
        ]
    : styles.targetPaneClosed;
  return (
    <View style={styles.root}>
      <View style={styles.toolbar}>
        {header !== undefined && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={header.closeLabel}
            onPress={header.onClose}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          >
            <Ionicons name={header.closeIcon ?? "close"} size={23} color={colors.text} />
          </Pressable>
        )}
        <BrowserButton label="Back" icon="chevron-back" disabled={!navigation.canGoBack} onPress={() => webView.current?.goBack()} />
        <BrowserButton label="Forward" icon="chevron-forward" disabled={!navigation.canGoForward} onPress={() => webView.current?.goForward()} />
        <BrowserButton label="Reload" icon="refresh" onPress={() => webView.current?.reload()} />
        <View style={styles.location}>
          {header !== undefined && (
            <View style={styles.locationTitleRow}>
              <Text numberOfLines={1} style={styles.locationTitle}>{header.title}</Text>
              {header.status !== undefined && (
                <View style={styles.headerStatus}><Text style={styles.headerStatusText}>{header.status}</Text></View>
              )}
            </View>
          )}
          <Text numberOfLines={1} ellipsizeMode="middle" style={[styles.locationText, header === undefined && styles.locationTextCentered]}>
            {browserLocation(navigation.url)}
          </Text>
        </View>
        {devToolsOpen && bridge?.tracingSupported === true && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={traceRunning ? "Stop native browser performance trace" : "Start native browser performance trace"}
            accessibilityState={{ selected: traceRunning }}
            onPress={() => void toggleTrace()}
            style={({ pressed }) => [styles.button, traceRunning && styles.traceButton, pressed && styles.pressed]}
          >
            <Ionicons name={traceRunning ? "stop-circle" : "pulse"} size={20} color={traceRunning ? colors.red : colors.textMuted} />
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={devToolsOpen ? "Close Chromium DevTools" : "Open Chromium DevTools"}
          accessibilityState={{ selected: devToolsOpen, busy: devToolsLoading || devToolsDocumentLoading }}
          disabled={devToolsLoading}
          onPress={() => devToolsOpen ? closeDevTools() : void openDevTools()}
          style={({ pressed }) => [styles.button, devToolsOpen && styles.activeButton, pressed && styles.pressed]}
        >
          {devToolsLoading
            ? <ActivityIndicator size="small" color={colors.text} />
            : <Ionicons name="code-slash" size={20} color={devToolsOpen ? colors.accent : colors.textMuted} />}
        </Pressable>
      </View>
      {traceStatus !== null && <Text numberOfLines={1} style={styles.traceStatus}>{traceStatus}</Text>}
      <View
        style={[
          styles.content,
          verticalDock && (devToolsDockSide === "left" ? styles.contentRowReverse : styles.contentRow),
        ]}
        onLayout={onContentLayout}
      >
        <View style={targetPaneStyle}>
          <WebView
            ref={webView}
            style={styles.webView}
            source={{ uri: url, ...(headers === undefined ? {} : { headers }) }}
            originWhitelist={originWhitelist}
            sharedCookiesEnabled
            thirdPartyCookiesEnabled={false}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState
            renderLoading={() => <ActivityIndicator style={styles.loading} color={colors.accent} />}
            onNavigationStateChange={(event) => setNavigation(event)}
            onHttpError={(event) => onHttpError?.(event.nativeEvent.statusCode)}
            onError={(event) => onError?.(event.nativeEvent.description)}
          />
        </View>
        {devToolsUrl !== null && (
          <>
            <View
              accessibilityRole="adjustable"
              accessibilityLabel="Resize browser and DevTools panes"
              style={[
                styles.divider,
                verticalDock ? styles.dividerVertical : styles.dividerHorizontal,
                devToolsDockSide === "undocked" && styles.dividerHidden,
              ]}
              {...dividerPanResponder.panHandlers}
            >
              <View style={[styles.dividerHandle, verticalDock ? styles.dividerHandleVertical : styles.dividerHandleHorizontal]} />
            </View>
            <DevToolsErrorBoundary
              resetKey={`${devToolsUrl}:${devToolsRevision}`}
              context={`Target: ${browserLocation(navigation.url)}\nFrontend: ${redactDevToolsUrl(devToolsUrl)}`}
              onFailure={(failure) => onError?.(`Chromium DevTools: ${failure.message}`)}
              onRetry={retryDevTools}
              onClose={closeDevTools}
            >
            <View style={styles.devToolsPane}>
              <WebView
                key={`${devToolsUrl}:${devToolsRevision}`}
                ref={devToolsWebView}
                testID="chromium-devtools-webview"
                style={styles.devTools}
                source={{ uri: devToolsUrl }}
                originWhitelist={["http://127.0.0.1:*"]}
                javaScriptEnabled
                domStorageEnabled
                injectedJavaScriptBeforeContentLoaded={DEVTOOLS_BOOTSTRAP}
                injectedJavaScript={DEVTOOLS_HEALTH_PROBE}
                setSupportMultipleWindows={false}
                onLoadStart={() => {
                  setDevToolsDocumentLoading(true);
                  setDevToolsFailure(null);
                }}
                onMessage={handleDevToolsMessage}
                onHttpError={(event) => {
                  const description = `frontend returned HTTP ${event.nativeEvent.statusCode}`;
                  setDevToolsDocumentLoading(false);
                  captureDevToolsFailure("load", description);
                  onError?.(`Chromium DevTools: ${description}`);
                }}
                onError={(event) => {
                  setDevToolsDocumentLoading(false);
                  captureDevToolsFailure("load", event.nativeEvent.description, `Code: ${event.nativeEvent.code}`);
                  onError?.(`Chromium DevTools: ${event.nativeEvent.description}`);
                }}
                onRenderProcessGone={(event) => {
                  const description = event.nativeEvent.didCrash
                    ? "Android WebView renderer crashed"
                    : "Android stopped the WebView renderer";
                  setDevToolsDocumentLoading(false);
                  captureDevToolsFailure("renderer", description, `didCrash: ${String(event.nativeEvent.didCrash)}`);
                  onError?.(`Chromium DevTools: ${description}`);
                }}
              />
              {devToolsDocumentLoading && (
                <View pointerEvents="none" style={styles.devToolsLoading}>
                  <ActivityIndicator color={colors.accent} />
                  <Text style={styles.devToolsStatus}>Loading Chromium DevTools…</Text>
                </View>
              )}
              {devToolsFailure !== null && (
                <View style={styles.devToolsError}>
                  <DevToolsFailurePanel failure={devToolsFailure} onRetry={retryDevTools} onClose={closeDevTools} />
                </View>
              )}
            </View>
            </DevToolsErrorBoundary>
          </>
        )}
      </View>
    </View>
  );
}

function BrowserButton({ label, icon, disabled = false, onPress }: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, disabled && styles.disabled, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={20} color={colors.textMuted} />
    </Pressable>
  );
}

async function findInspectablePage(
  endpoint: NativeBrowserDevToolsBridge,
  pageUrl: string,
  marker: InspectablePageMarker,
): Promise<DevToolsTarget> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      marker.apply();
      await delay(50);
      const response = await fetch(`http://${endpoint.host}:${endpoint.port}/json/list?codewide_token=${endpoint.token}`);
      if (!response.ok) throw new Error(`DevTools discovery returned HTTP ${response.status}`);
      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) throw new Error("DevTools discovery returned an invalid target list");
      const targets = payload.filter(isDevToolsTarget).filter((target) => target.type === "page" && !isBundledDevToolsUrl(target.url));
      const urlMatches = targets.filter((candidate) => samePageUrl(candidate.url, pageUrl));
      const otherTargets = targets.filter((candidate) => !urlMatches.includes(candidate));
      for (const candidates of [urlMatches, otherTargets]) {
        const probes = await Promise.all(candidates.map(async (candidate) => ({
          candidate,
          matched: await targetContainsMarker(endpoint, candidate, marker.id),
        })));
        const exact = probes.find((probe) => probe.matched);
        if (exact !== undefined) return exact.candidate;
      }
      lastError = new Error(`No CDP target owns the browser WebView at ${browserLocation(pageUrl)} (${targets.length} targets probed)`);
    } catch (cause) {
      lastError = cause;
    }
    await delay(100);
  }
  throw lastError instanceof Error ? lastError : new Error("No inspectable WebView target is available");
}

function chromiumDevToolsUrl(endpoint: NativeBrowserDevToolsBridge, target: DevToolsTarget): string {
  const websocket = proxiedWebSocketUrl(endpoint, target).replace(/^ws:\/\//u, "");
  const query = new URLSearchParams({ ws: websocket, can_dock: "true" });
  return `http://${endpoint.host}:${endpoint.port}/browser-devtools/${endpoint.token}/front_end/inspector.html?${query.toString()}`;
}

function proxiedWebSocketUrl(endpoint: NativeBrowserDevToolsBridge, target: DevToolsTarget): string {
  const discoveredSocket = new URL(target.webSocketDebuggerUrl);
  if (discoveredSocket.protocol !== "ws:" && discoveredSocket.protocol !== "wss:") {
    throw new Error("DevTools target returned an invalid WebSocket URL");
  }
  const path = `${discoveredSocket.pathname}${discoveredSocket.search}`;
  const separator = discoveredSocket.search.length > 0 ? "&" : "?";
  return `ws://${endpoint.host}:${endpoint.port}${path}${separator}codewide_token=${encodeURIComponent(endpoint.token)}`;
}

function isDevToolsTarget(value: unknown): value is DevToolsTarget {
  return value !== null && typeof value === "object"
    && typeof (value as Partial<DevToolsTarget>).id === "string"
    && typeof (value as Partial<DevToolsTarget>).type === "string"
    && typeof (value as Partial<DevToolsTarget>).title === "string"
    && typeof (value as Partial<DevToolsTarget>).url === "string"
    && typeof (value as Partial<DevToolsTarget>).webSocketDebuggerUrl === "string"
    && ((value as Partial<DevToolsTarget>).description === undefined
      || typeof (value as Partial<DevToolsTarget>).description === "string");
}

function targetContainsMarker(
  endpoint: NativeBrowserDevToolsBridge,
  target: DevToolsTarget,
  marker: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let socket: WebSocket | null = null;
    const finish = (matched: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (socket !== null && socket.readyState < WebSocket.CLOSING) socket.close(1000, "probe complete");
      resolve(matched);
    };
    const timeout = setTimeout(() => finish(false), 750);
    try {
      socket = new WebSocket(proxiedWebSocketUrl(endpoint, target));
      socket.onopen = () => {
        socket?.send(JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: {
            expression: "globalThis.__codewideDevToolsTargetMarker || null",
            returnByValue: true,
          },
        }));
      };
      socket.onmessage = (event) => {
        try {
          const response: unknown = JSON.parse(String(event.data));
          const id = (response as { id?: unknown }).id;
          const value = (response as { result?: { result?: { value?: unknown } } }).result?.result?.value;
          if (id === 1) finish(value === marker);
        } catch {
          finish(false);
        }
      };
      socket.onerror = () => finish(false);
      socket.onclose = () => finish(false);
    } catch {
      finish(false);
    }
  });
}

type InspectablePageMarker = { id: string; apply(): void; restore(): void };

function markInspectablePage(target: WebView | null): InspectablePageMarker {
  const id = `__codewide_devtools_target_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  if (target === null) return { id, apply() {}, restore() {} };
  return {
    id,
    apply() {
      try {
        target.injectJavaScript(`
          globalThis.__codewideDevToolsTargetMarker = ${JSON.stringify(id)};
          true;
        `);
      } catch {
        // Discovery retries before reporting that no exact target was found.
      }
    },
    restore() {
      try {
        target.injectJavaScript(`
          if (globalThis.__codewideDevToolsTargetMarker === ${JSON.stringify(id)}) {
            delete globalThis.__codewideDevToolsTargetMarker;
          }
          true;
        `);
      } catch {
        // The inspected WebView may have been closed while discovery was in flight.
      }
    },
  };
}

function isBundledDevToolsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "127.0.0.1" && parsed.pathname.startsWith("/browser-devtools/");
  } catch {
    return false;
  }
}

function redactDevToolsUrl(url: string): string {
  return url
    .replace(/\/browser-devtools\/[^/]+\//u, "/browser-devtools/<redacted>/")
    .replace(/([?&]codewide_token=)[^&]+/gu, "$1<redacted>");
}

type DevToolsMessage =
  | { source: "codewide-devtools-health"; state: "ready" | "error"; message?: string }
  | { source: "codewide-devtools-dock"; side: DevToolsDockSide }
  | { source: "codewide-devtools-transport"; event: "open" | "close" | "error"; code: number; reason: string };

function parseDevToolsMessage(value: string): DevToolsMessage | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed === null || typeof parsed !== "object") return null;
    const source = (parsed as { source?: unknown }).source;
    if (source === "codewide-devtools-dock") {
      const side = (parsed as { side?: unknown }).side;
      return isDevToolsDockSide(side) ? { source, side } : null;
    }
    if (source === "codewide-devtools-transport") {
      const event = (parsed as { event?: unknown }).event;
      if (event !== "open" && event !== "close" && event !== "error") return null;
      const code = (parsed as { code?: unknown }).code;
      const reason = (parsed as { reason?: unknown }).reason;
      return { source, event, code: typeof code === "number" ? code : 0, reason: typeof reason === "string" ? reason : "" };
    }
    if (source !== "codewide-devtools-health") return null;
    const state = (parsed as { state?: unknown }).state;
    if (state !== "ready" && state !== "error") return null;
    const message = (parsed as { message?: unknown }).message;
    return { source, state, ...(typeof message === "string" ? { message } : {}) };
  } catch {
    return null;
  }
}

function isDevToolsDockSide(value: unknown): value is DevToolsDockSide {
  return value === "bottom" || value === "left" || value === "right" || value === "undocked";
}

const DEVTOOLS_BOOTSTRAP = `
  (() => {
    const post = (payload) => window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    try {
      const defaultAppliedKey = "codewideDockDefaultV1";
      if (window.localStorage.getItem(defaultAppliedKey) !== "applied") {
        window.localStorage.setItem("currentDockState", JSON.stringify("bottom"));
        window.localStorage.setItem("lastDockState", JSON.stringify("bottom"));
        window.localStorage.setItem(defaultAppliedKey, "applied");
      }
    } catch (_) {}

    let lastDockSide = "";
    let collapsedInternalPaneForSide = "";
    const collapseDuplicateInspectedPage = (side) => {
      if (collapsedInternalPaneForSide === side) return;
      try {
        const advancedApp = window.Emulation?.AdvancedApp?.instance?.();
        const split = advancedApp?.rootSplitWidget;
        if (typeof split?.hideMain !== "function") return;
        split.hideMain();
        collapsedInternalPaneForSide = side;
      } catch (_) {}
    };
    const reportDockSide = () => {
      let side = "bottom";
      try {
        const stored = JSON.parse(window.localStorage.getItem("currentDockState") || '"bottom"');
        if (["bottom", "left", "right", "undocked"].includes(stored)) side = stored;
      } catch (_) {}
      collapseDuplicateInspectedPage(side);
      if (side !== lastDockSide) {
        lastDockSide = side;
        post({ source: "codewide-devtools-dock", side });
      }
    };
    reportDockSide();
    window.setInterval(reportDockSide, 100);

    const NativeWebSocket = window.WebSocket;
    function CodeWideWebSocket(url, protocols) {
      const socket = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
      socket.addEventListener("open", () => post({ source: "codewide-devtools-transport", event: "open", code: 0, reason: "" }));
      socket.addEventListener("error", () => post({ source: "codewide-devtools-transport", event: "error", code: 0, reason: "" }));
      socket.addEventListener("close", (event) => post({
        source: "codewide-devtools-transport",
        event: "close",
        code: event.code,
        reason: event.reason || "",
      }));
      return socket;
    }
    CodeWideWebSocket.prototype = NativeWebSocket.prototype;
    try { Object.setPrototypeOf(CodeWideWebSocket, NativeWebSocket); } catch (_) {}
    window.WebSocket = CodeWideWebSocket;
  })();
  true;
`;

const DEVTOOLS_HEALTH_PROBE = `
  (() => {
    let attempts = 0;
    let lastError = "";
    const post = (state, message) => window.ReactNativeWebView.postMessage(JSON.stringify({
      source: "codewide-devtools-health",
      state,
      ...(message ? { message } : {}),
    }));
    window.addEventListener("error", (event) => { lastError = event.message || "DevTools frontend script failed"; });
    window.addEventListener("unhandledrejection", (event) => {
      lastError = event.reason instanceof Error ? event.reason.message : String(event.reason || "DevTools frontend promise failed");
    });
    const probe = () => {
      if (document.body && document.body.childElementCount > 0) {
        post("ready");
        return;
      }
      attempts += 1;
      if (attempts >= 40) {
        post("error", lastError || "DevTools frontend stayed empty for 10 seconds");
        return;
      }
      window.setTimeout(probe, 250);
    };
    window.setTimeout(probe, 250);
  })();
  true;
`;

function samePageUrl(left: string, right: string): boolean {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    return leftUrl.origin === rightUrl.origin && normalizePath(leftUrl.pathname) === normalizePath(rightUrl.pathname);
  } catch {
    return left === right;
  }
}

function normalizePath(path: string): string { return path.length > 1 ? path.replace(/\/$/u, "") : path; }
function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function formatBytes(bytes: number): string { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`; }

function browserLocation(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: colors.background },
  toolbar: { minHeight: touchTarget, flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSoft, backgroundColor: colors.surface },
  location: { flex: 1, minWidth: 0, justifyContent: "center", paddingHorizontal: spacing.xs },
  locationTitleRow: { minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  locationTitle: { flexShrink: 1, color: colors.text, ...typeScale.labelMedium },
  locationText: { color: colors.textMuted, ...typeScale.labelMedium },
  locationTextCentered: { textAlign: "center" },
  headerStatus: { flexShrink: 0, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: colors.successContainer },
  headerStatusText: { color: colors.green, fontSize: 9, lineHeight: 12, fontWeight: "700" },
  button: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  activeButton: { backgroundColor: colors.surfaceRaised },
  traceButton: { backgroundColor: colors.surfaceRaised },
  traceStatus: { minHeight: 22, paddingHorizontal: spacing.sm, paddingVertical: 3, color: colors.textMuted, backgroundColor: colors.surface, ...typeScale.labelMedium },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.7 },
  content: { flex: 1, minHeight: 0 },
  contentRow: { flexDirection: "row" },
  contentRowReverse: { flexDirection: "row-reverse" },
  targetPane: { flexShrink: 0, minWidth: 0, minHeight: 0 },
  targetPaneClosed: { flex: 1, minWidth: 0, minHeight: 0 },
  targetPaneUndocked: { position: "absolute", width: 1, height: 1, opacity: 0 },
  divider: { flexShrink: 0, alignItems: "center", justifyContent: "center", backgroundColor: "transparent" },
  dividerHorizontal: { width: "100%", height: 10 },
  dividerVertical: { width: 10, height: "100%" },
  dividerHidden: { display: "none" },
  dividerHandle: { borderRadius: 1, backgroundColor: colors.border },
  dividerHandleHorizontal: { width: 48, height: 2 },
  dividerHandleVertical: { width: 2, height: 48 },
  webView: { flex: 1, backgroundColor: colors.background },
  devToolsPane: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: "#202124" },
  devTools: { flex: 1, minWidth: 0, minHeight: 0, backgroundColor: "#202124" },
  devToolsLoading: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: "#202124" },
  devToolsError: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.lg, backgroundColor: "#202124" },
  devToolsStatus: { color: colors.textMuted, textAlign: "center", ...typeScale.bodyMedium },
  loading: { position: "absolute", inset: 0 },
});
