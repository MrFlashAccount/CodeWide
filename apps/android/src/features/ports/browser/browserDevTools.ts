import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";
import {
  startNativeBrowserDevToolsBridge,
  stopNativeBrowserDevToolsBridge,
  type NativeBrowserDevToolsBridge,
} from "../../../native/native-transport";
import { useEvent } from "../../../react/useEvent";
import {
  createDevToolsFailure,
  type DevToolsFailure,
  type DevToolsFailureKind,
} from "../../../ui/DevToolsErrorBoundary";
import { captureBrowserScreenshot } from "./capture-screenshot";
import { parseDevToolsMessage, redactDevToolsUrl, type DevToolsDockSide } from "./devToolsMessage";
import {
  browserLocation,
  chromiumDevToolsUrl,
  findInspectablePage,
  markInspectablePage,
  proxiedWebSocketUrl,
  type DevToolsTarget,
} from "./devToolsTarget";
export function useBrowserDevTools(
  webView: RefObject<WebView | null>,
  navigation: Pick<WebViewNavigation, "url">,
  onError: ((description: string) => void) | undefined,
) {
  const devToolsWebView = useRef<WebView>(null);
  const mounted = useRef(true);
  const bridgeStarted = useRef(false);
  const [devToolsUrl, setDevToolsUrl] = useState<string | null>(null);
  const [devToolsLoading, setDevToolsLoading] = useState(false);
  const [devToolsDocumentLoading, setDevToolsDocumentLoading] = useState(false);
  const [devToolsFailure, setDevToolsFailure] = useState<DevToolsFailure | null>(null);
  const [devToolsRevision, setDevToolsRevision] = useState(0);
  const [devToolsDockSide, setDevToolsDockSide] = useState<DevToolsDockSide>("bottom");
  const [bridge, setBridge] = useState<NativeBrowserDevToolsBridge | null>(null);
  const reportError = useEvent((cause: unknown, fallback: string) => {
    onError?.(cause instanceof Error ? cause.message : fallback);
  });
  const captureDevToolsFailure = useEvent(
    (kind: DevToolsFailureKind, message: string, detail?: string) => {
      const failure = createDevToolsFailure(kind, message, {
        context: [
          `Target: ${browserLocation(navigation.url)}`,
          devToolsUrl === null ? null : `Frontend: ${redactDevToolsUrl(devToolsUrl)}`,
          detail ?? null,
        ]
          .filter((line): line is string => line !== null)
          .join("\n"),
      });
      console.error("Chromium DevTools failure", failure);
      setDevToolsFailure(failure);
      return failure;
    },
  );
  const openDevTools = useEvent(async () => {
    setDevToolsLoading(true);
    setDevToolsDocumentLoading(true);
    setDevToolsFailure(null);
    try {
      const endpoint = await startNativeBrowserDevToolsBridge();
      bridgeStarted.current = true;
      const marker = markInspectablePage(webView.current);
      marker.apply();
      const target: DevToolsTarget = await findInspectablePage(
        endpoint,
        navigation.url,
        marker,
      ).finally(marker.restore);
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
        captureDevToolsFailure(
          "bridge",
          cause instanceof Error
            ? cause.message
            : "Could not connect Chromium DevTools to this page",
        );
        reportError(cause, "Could not connect Chromium DevTools to this page");
      }
    }
    if (mounted.current) setDevToolsLoading(false);
  });
  const closeDevTools = useEvent(() => {
    if (bridgeStarted.current) {
      bridgeStarted.current = false;
      stopNativeBrowserDevToolsBridge();
    }
    setBridge(null);
    setDevToolsUrl(null);
    setDevToolsDocumentLoading(false);
    setDevToolsFailure(null);
    setDevToolsDockSide("bottom");
  });
  const handleDevToolsMessage = useEvent((event: WebViewMessageEvent) => {
    const message = parseDevToolsMessage(event.nativeEvent.data);
    if (message === null) return;
    if (message.source === "codewide-devtools-dock") {
      setDevToolsDockSide(message.side);
      return;
    }
    if (message.source === "codewide-devtools-transport") {
      if (message.event === "close") {
        const detail = [
          `Close code: ${message.code}`,
          message.reason.length > 0 ? `Reason: ${message.reason}` : null,
        ]
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
  const captureScreenshot = useEvent(async (): Promise<string | null> => {
    let endpoint = bridge;
    if (endpoint === null) endpoint = await startNativeBrowserDevToolsBridge();
    if (!mounted.current) {
      if (bridge === null) stopNativeBrowserDevToolsBridge();
      return null;
    }
    bridgeStarted.current = true;
    setBridge(endpoint);
    const marker = markInspectablePage(webView.current);
    marker.apply();
    const target = await findInspectablePage(endpoint, navigation.url, marker).finally(
      marker.restore,
    );
    return await captureBrowserScreenshot(proxiedWebSocketUrl(endpoint, target));
  });
  const isMounted = useEvent(() => mounted.current);
  return {
    devToolsWebView,
    devToolsUrl,
    devToolsLoading,
    devToolsDocumentLoading,
    devToolsFailure,
    devToolsRevision,
    devToolsDockSide,
    setDevToolsDocumentLoading,
    setDevToolsFailure,
    captureDevToolsFailure,
    openDevTools,
    closeDevTools,
    handleDevToolsMessage,
    retryDevTools,
    captureScreenshot,
    isMounted,
  };
}
