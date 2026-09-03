import { useEffect, useRef, useState } from "react";
import { BackHandler, Platform } from "react-native";
import type { WebView, WebViewMessageEvent, WebViewNavigation } from "react-native-webview";

import type {
  BrowserDevToolsCapability,
  BrowserDevToolsEndpoint,
  DevToolsDockSide,
} from "../../application/ports/browserDevTools";
import { useEvent } from "../../../react/useEvent";
import {
  DEVTOOLS_BOOTSTRAP,
  DEVTOOLS_HEALTH_PROBE,
  parseDevToolsDocumentMessage,
} from "../ports/browserDevToolsDocument";
import {
  chromiumDevToolsUrl,
  findInspectablePage,
  markInspectablePage,
  type DevToolsTarget,
} from "../ports/browserDevToolsProtocol";

export interface InternalBrowserController {
  closeDevTools(): void;
  devToolsBootstrap: string;
  devToolsDockSide: DevToolsDockSide;
  devToolsError: string | null;
  devToolsLoading: boolean;
  devToolsDocumentLoading: boolean;
  devToolsUrl: string | null;
  goBack(): void;
  goForward(): void;
  healthProbe: string;
  navigation: Pick<WebViewNavigation, "canGoBack" | "canGoForward" | "url">;
  onDevToolsError(message: string): void;
  onDevToolsLoadStart(): void;
  onDevToolsMessage(event: WebViewMessageEvent): void;
  onNavigation(value: WebViewNavigation): void;
  onRendererGone(didCrash: boolean): void;
  openDevTools(): Promise<void>;
  reload(): void;
  retryDevTools(): void;
  setBrowserRef(value: WebView | null): void;
  setDevToolsRef(value: WebView | null): void;
  toggleTrace(): Promise<void>;
  traceRunning: boolean;
  traceSupported: boolean;
  traceStatus: string | null;
}

interface UseInternalBrowserControllerInput {
  capability: BrowserDevToolsCapability;
  onClose(): void;
  pageUrl: string;
}

/** Owns native browser synchronization and guarantees DevTools bridge cleanup. */
export function useInternalBrowserController(
  input: UseInternalBrowserControllerInput,
): InternalBrowserController {
  const { capability, onClose, pageUrl } = input;
  const browserRef = useRef<WebView>(null);
  const devToolsRef = useRef<WebView>(null);
  const mounted = useRef(true);
  const bridgeStarted = useRef(false);
  const traceStarted = useRef(false);
  const [navigation, setNavigation] = useState<
    Pick<WebViewNavigation, "canGoBack" | "canGoForward" | "url">
  >({ canGoBack: false, canGoForward: false, url: pageUrl });
  const [devToolsUrl, setDevToolsUrl] = useState<string | null>(null);
  const [devToolsLoading, setDevToolsLoading] = useState(false);
  const [devToolsDocumentLoading, setDevToolsDocumentLoading] = useState(false);
  const [devToolsError, setDevToolsError] = useState<string | null>(null);
  const [devToolsDockSide, setDevToolsDockSide] = useState<DevToolsDockSide>("bottom");
  const [traceRunning, setTraceRunning] = useState(false);
  const [traceSupported, setTraceSupported] = useState(false);
  const [traceStatus, setTraceStatus] = useState<string | null>(null);
  const stopDevToolsBridge = useEvent(() => {
    if (!bridgeStarted.current) return;
    bridgeStarted.current = false;
    capability.stop();
  });
  const closeDevTools = useEvent(() => {
    if (traceStarted.current) {
      traceStarted.current = false;
      void capability.stopTracing().catch(() => undefined);
    }
    stopDevToolsBridge();
    setDevToolsUrl(null);
    setDevToolsError(null);
    setDevToolsDockSide("bottom");
    setDevToolsLoading(false);
    setDevToolsDocumentLoading(false);
    setTraceRunning(false);
    setTraceSupported(false);
    setTraceStatus(null);
  });
  const reportError = useEvent((message: string) => {
    setDevToolsError(message);
    setDevToolsDocumentLoading(false);
  });
  const connectDevTools = useEvent(async () => {
    const started = await settle(capability.start());
    if (!started.ok) {
      if (mounted.current) {
        reportError(errorMessage(started.cause, "Could not connect Chromium DevTools"));
      }
      return;
    }
    const endpoint = started.value;
    setTraceSupported(endpoint.tracingSupported);
    bridgeStarted.current = true;
    const inspected = await settle(
      inspectDevToolsTarget(endpoint, navigation.url, browserRef.current),
    );
    if (!inspected.ok) {
      stopDevToolsBridge();
      if (mounted.current) {
        reportError(errorMessage(inspected.cause, "Could not connect Chromium DevTools"));
      }
      return;
    }
    if (mounted.current) {
      setDevToolsUrl(chromiumDevToolsUrl(endpoint, inspected.value));
    } else stopDevToolsBridge();
  });
  const openDevTools = useEvent(async () => {
    if (devToolsLoading || devToolsUrl !== null) return;
    setDevToolsLoading(true);
    setDevToolsDocumentLoading(true);
    setDevToolsError(null);
    setTraceStatus(null);
    await connectDevTools().finally(() => {
      if (mounted.current) setDevToolsLoading(false);
    });
  });
  const onDevToolsMessage = useEvent((event: WebViewMessageEvent) => {
    const message = parseDevToolsDocumentMessage(event.nativeEvent.data);
    if (message === null) return;
    if (message.source === "dock") {
      setDevToolsDockSide(message.side);
      return;
    }
    if (message.source === "transport") {
      if (message.event !== "open") {
        reportError(message.reason ?? "Chromium DevTools connection closed");
      }
      return;
    }
    setDevToolsDocumentLoading(false);
    if (message.state === "ready") setDevToolsError(null);
    else reportError(message.message ?? "Chromium DevTools did not render");
  });
  const onDevToolsError = useEvent((message: string) => reportError(message));
  const onDevToolsLoadStart = useEvent(() => {
    setDevToolsDocumentLoading(true);
    setDevToolsError(null);
  });
  const onNavigation = useEvent((value: WebViewNavigation) => setNavigation(value));
  const onRendererGone = useEvent((didCrash: boolean) =>
    reportError(didCrash ? "Android WebView renderer crashed" : "Android stopped WebView"),
  );
  const reload = useEvent(() => browserRef.current?.reload());
  const retryDevTools = useEvent(() => {
    setDevToolsError(null);
    setDevToolsDocumentLoading(true);
    devToolsRef.current?.reload();
  });
  const setBrowserRef = useEvent((value: WebView | null) => {
    browserRef.current = value;
  });
  const setDevToolsRef = useEvent((value: WebView | null) => {
    devToolsRef.current = value;
  });
  const goBack = useEvent(() => browserRef.current?.goBack());
  const goForward = useEvent(() => browserRef.current?.goForward());
  const toggleTrace = useEvent(async () => {
    try {
      if (traceRunning) {
        const result = await capability.stopTracing();
        traceStarted.current = false;
        setTraceRunning(false);
        setTraceStatus(`Trace captured · ${formatBytes(result.size)}`);
      } else {
        await capability.startTracing();
        traceStarted.current = true;
        setTraceRunning(true);
        setTraceStatus("Recording native WebView trace");
      }
    } catch (cause) {
      setTraceRunning(false);
      reportError(errorMessage(cause, "Could not capture WebView trace"));
    }
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (traceStarted.current) {
        traceStarted.current = false;
        void capability.stopTracing().catch(() => undefined);
      }
      if (bridgeStarted.current) {
        bridgeStarted.current = false;
        capability.stop();
      }
    };
  }, [capability]);

  useEffect(() => {
    if (Platform.OS !== "android") return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (devToolsUrl !== null) closeDevTools();
      else if (navigation.canGoBack) browserRef.current?.goBack();
      else onClose();
      return true;
    });
    return () => subscription.remove();
  }, [closeDevTools, devToolsUrl, navigation.canGoBack, onClose]);

  return {
    closeDevTools,
    devToolsBootstrap: DEVTOOLS_BOOTSTRAP,
    devToolsDockSide,
    devToolsError,
    devToolsLoading,
    devToolsDocumentLoading,
    devToolsUrl,
    goBack,
    goForward,
    healthProbe: DEVTOOLS_HEALTH_PROBE,
    navigation,
    onDevToolsError,
    onDevToolsLoadStart,
    onDevToolsMessage,
    onNavigation,
    onRendererGone,
    openDevTools,
    reload,
    retryDevTools,
    setBrowserRef,
    setDevToolsRef,
    toggleTrace,
    traceRunning,
    traceSupported,
    traceStatus,
  };
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message !== "" ? cause.message : fallback;
}

type Settled<T> = { cause: unknown; ok: false } | { ok: true; value: T };

function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  return promise.then(
    (value): Settled<T> => ({ ok: true, value }),
    (cause: unknown): Settled<T> => ({ cause, ok: false }),
  );
}

async function inspectDevToolsTarget(
  endpoint: BrowserDevToolsEndpoint,
  pageUrl: string,
  browser: WebView | null,
): Promise<DevToolsTarget> {
  const marker = markInspectablePage(browser);
  marker.apply();
  return findInspectablePage(endpoint, pageUrl, marker).finally(marker.restore);
}

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
